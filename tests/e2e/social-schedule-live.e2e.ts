import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { table, withRequestCache } from '../../lib/db'
import { attachOne } from '../../lib/db-join'
import type {
  AssetVersion, ContentItem, PublishJob, ScheduleNote, SocialAccount, SocialPost,
  TeamUserClient,
} from '../../lib/db-types'
import type { TeamUser } from '../../app/lib/authz'
import {
  addMediaVersion, addNote, cancelPost, createPost, editNote, listNotes, listPosts,
  removeNote, reschedule, schedulePost, sendForApproval, updatePost,
} from '../../app/lib/social-schedule'
import { actOnPostingApproval } from '../../app/lib/posting-approval'

/**
 * THE SOCIAL SCHEDULE, PLAYED AGAINST THE REAL DATABASE.
 *
 * The route tests (`tests/social-schedule-routes.test.ts`) run the same flow
 * over an in-memory fake of the Realtime Database. That fake is good, and it
 * is still a fake: it cannot show that a claim really is atomic at the REST
 * layer, that a natural-key row really is refused twice, or that the shapes
 * this code writes are shapes the real database will hand back. This file
 * does the whole journey against the real one:
 *
 *   create → send for approval → approve as the account manager → book it in
 *   (dry run) → move it → cancel it (and watch the item's gate reset)
 *
 * …then the two paths that go round the middle of that — skipping the ask
 * ("direct"), and bringing in a file the client has never seen, which makes a
 * new version and sends the piece back to them — and the rights on a note.
 *
 * ── SAFETY, RE-CHECKED AT RUN TIME RATHER THAN TRUSTED ──────────────────
 *
 *  • only the dedicated "ZZ TEST" client and its four `.invalid` accounts;
 *  • `EMAIL_TEST_ONLY=1` (from `tests/e2e/load-env.ts`) — and the run refuses
 *    to start without it, or if a real address is on the client;
 *  • `PUBLISH_DRY_RUN=1` — the provider itself answers with a fake id and
 *    opens no socket, so nothing can reach a real account;
 *  • the channel it posts to is a `social_accounts` row this file creates,
 *    with a `zz-test-` provider id that exists nowhere but here, and it is
 *    deleted at the end;
 *  • every row it creates is deleted in `afterAll`, and every table it
 *    touched is read back and asserted empty of this run's rows.
 *
 * Run it explicitly:
 *
 *   EMAIL_TEST_ONLY=1 PUBLISH_DRY_RUN=1 \
 *     npx vitest run --config vitest.e2e.config.mts tests/e2e/social-schedule-live.e2e.ts
 */

const TEST_CLIENT_ID = '99ba2c6f-4db5-4782-9395-9048f215886c'
const IDS = {
  am: '3548cc71-5a34-4fe9-9130-11579d1a4137',
  editor: 'e30e0242-63f1-4855-8e3a-b23b293ec11d',
  scheduler: '0e7fcf9f-bcf5-4080-ab7c-1b1f8fed1d13',
}

const STAMP = Date.now()
const TAG = `ZZ TEST SCHEDULE ${STAMP}`

/**
 * Where the media pretends to live.
 *
 * Our own public storage base when it is configured, so the URLs are exactly
 * the shape everything else in the app writes. Nothing FETCHES them in a dry
 * run — the provider never sees them and no job is ever dispatched — so a
 * base with no bytes behind it is honest here rather than convenient.
 */
const MEDIA_BASE = (
  process.env.R2_PUBLIC_BASE_URL
  ?? process.env.NEXT_PUBLIC_ASSET_URL
  ?? 'https://media.mdmmarketing.com.au'
).replace(/\/$/, '')

/** the shape `objectKey()` mints, so these read as our own files */
const file = (name: string) => `${MEDIA_BASE}/${STAMP}-zztest-${name}`

const SLIDES = [
  { url: file('one.jpg'), name: 'one.jpg', type: 'image' as const },
  { url: file('two.jpg'), name: 'two.jpg', type: 'image' as const },
]
const BROUGHT_IN = { url: file('three.jpg'), name: 'three.jpg', type: 'image' as const }

let am: TeamUser, editor: TeamUser, scheduler: TeamUser

/* ── the teardown lists ─────────────────────────────────────────────────── */

const created = {
  items: new Set<string>(),
  versions: new Set<string>(),
  posts: new Set<string>(),
  notes: new Set<string>(),
  accounts: new Set<string>(),
  jobs: new Set<string>(),
  locks: new Set<string>(),
}

/**
 * Everything this run MADE, counted as it is made.
 *
 * Separate from the sets above, which are the teardown lists and shrink as
 * rows are removed along the way (a note this file deletes itself is still a
 * row it created). The count is what the run reports; the sets are what it
 * cleans up.
 */
const made: Record<string, number> = {}
const tick = (what: string, n = 1) => { made[what] = (made[what] ?? 0) + n }

const nowPlus = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString()

/** A fresh piece on the ZZ TEST client, already approved for scheduling, with
 *  one version carrying two pictures. */
async function makePiece(title: string): Promise<{ itemId: string; versionId: string }> {
  const item = await table<ContentItem>('content_items').insert({
    client_id: TEST_CLIENT_ID,
    title: `${TAG} — ${title}`,
    content_type: 'carousel',
    platform_targets: ['instagram'],
    priority: 'normal',
    client_approval_required: false,
    owner_id: IDS.editor,
    scheduler_ids: [],
    caption: 'Hello from the harness',
    status: 'approved_for_scheduling',
    current_version_number: 1,
    posting_approval_state: null,
  } as never)
  created.items.add(item.id)
  tick('content_items')

  const version = await table<AssetVersion>('asset_versions').insert({
    item_id: item.id,
    version_number: 1,
    files: SLIDES,
    file_url: SLIDES[0].url,
    dropbox_url: '',
    drive_url: '',
    notes: `${TAG} version 1`,
    uploaded_by: IDS.editor,
  } as never)
  created.versions.add(version.id)
  tick('asset_versions')

  return { itemId: item.id, versionId: version.id }
}

const itemRow = async (id: string) =>
  (await table<ContentItem>('content_items').get(id, { fresh: true }))!

const postRow = async (id: string) =>
  (await table<SocialPost>('social_posts').get(id, { fresh: true }))!

/** remember a post and every lock/job it will have taken */
function remember(post: { id: string; item_id: string; publish_job_ids?: unknown }) {
  if (!created.posts.has(post.id)) tick('social_posts')
  created.posts.add(post.id)
  created.locks.add(`social_post__${post.item_id}`)
  created.locks.add(`publish__${post.item_id}`)
  for (const j of (Array.isArray(post.publish_job_ids) ? post.publish_job_ids : [])) {
    if (!created.jobs.has(String(j))) tick('publish_jobs')
    created.jobs.add(String(j))
  }
}

/* ── the gate ───────────────────────────────────────────────────────────── */

beforeAll(() => withRequestCache(async () => {
  if (process.env.EMAIL_TEST_ONLY !== '1') {
    throw new Error('EMAIL_TEST_ONLY is not set — refusing to run')
  }
  // The publisher answers for itself under this flag (`dryRunPublisher`), so a
  // booking cannot leave the building. Set here as well as on the command line
  // so a run that forgets it is not a run that posts to somebody's Instagram.
  process.env.PUBLISH_DRY_RUN = '1'

  const client = await table<{ id: string; name: string }>('clients').get(TEST_CLIENT_ID)
  if (!client) throw new Error('ZZ TEST client not found')
  if (!/^ZZ TEST/.test(client.name)) {
    throw new Error(`refusing to run against a client called "${client.name}"`)
  }

  const ids = new Set(Object.values(IDS))
  const people = await table<TeamUser & { id: string }>('team_users')
    .list({ where: u => ids.has(u.id) })
  const by = Object.fromEntries(people.map(u => [u.id, u]))
  am = by[IDS.am]; editor = by[IDS.editor]; scheduler = by[IDS.scheduler]
  if (!am || !editor || !scheduler) throw new Error('Test accounts missing — recreate them first')

  // the whole fan-out for this client must land on undeliverable addresses.
  // An UNASSIGNED client is unsafe too: resolveAudience falls back to emailing
  // every super admin when a client has no manager.
  const links = await table<TeamUserClient>('team_user_clients')
    .list({ by: { client_id: TEST_CLIENT_ID } })
  const withUsers = await attachOne(links, 'team_user_id', 'team_users', ['email'])
  const emails = withUsers
    .map(r => (r.team_users as { email: string } | null)?.email)
    .filter((e): e is string => !!e)
  if (emails.length === 0) throw new Error('ZZ TEST client has no assigned manager')
  const real = emails.filter(e => !e.endsWith('.invalid'))
  if (real.length > 0) throw new Error(`ZZ TEST client is managed by real people: ${real.join(', ')}`)

  // the channel. A row of our own, on a provider id that exists nowhere.
  const account = await table<SocialAccount>('social_accounts').insert({
    client_id: TEST_CLIENT_ID,
    platform: 'instagram',
    provider_account_id: `zz-test-${STAMP}`,
    name: `${TAG} channel`,
    username: `zz_test_${STAMP}`,
    avatar_url: null,
    active: true,
    connected_at: new Date().toISOString(),
    last_synced_at: new Date().toISOString(),
  } as never)
  created.accounts.add(account.id)
  tick('social_accounts')
  channelId = account.id

  console.log(`[setup] client=${TEST_CLIENT_ID} channel=${channelId} media base=${MEDIA_BASE}`)
}))

let channelId = ''

/* ── the whole way through ──────────────────────────────────────────────── */

describe('a planned post, live', () => {
  it('create → send → approve as the manager → book (dry) → move → cancel', async () => {
    const { itemId } = await makePiece('the main journey')

    /* create */
    const draft = await createPost(scheduler, {
      item_id: itemId,
      slides: SLIDES,
      caption: `${TAG} — hello everyone`,
      channels: [channelId],
      scheduled_for: nowPlus(2),
    })
    remember(draft)
    expect(draft.status).toBe('draft')
    expect(draft.slides).toHaveLength(2)
    console.log(`[A] post ${draft.id} created as a draft`)

    /* a draft cannot be booked in: the gate says so in words */
    await expect(schedulePost(scheduler, draft.id)).rejects.toThrow(/Send the post for approval first/)

    /* send for approval — the ITEM is what moves */
    const sent = await sendForApproval(scheduler, draft.id, { note: `${TAG} please look` })
    expect(sent.status).toBe('pending')
    expect(sent.sent_at).toBeTruthy()
    expect((await itemRow(itemId)).posting_approval_state).toBe('pending')

    /* …and while it waits, booking it in is refused in the same sentence
       every other path uses */
    await expect(schedulePost(scheduler, draft.id))
      .rejects.toThrow(/Waiting on final approval/)
    const waiting = (await listPosts({ clientId: TEST_CLIENT_ID }))
      .find(p => p.id === draft.id)
    expect(waiting?.block_reason).toMatch(/Waiting on final approval/)
    console.log('[A] the gate held a post nobody had approved')

    /* approve — through the same call the item page's route makes */
    await actOnPostingApproval(am, (await itemRow(itemId)) as never, {
      action: 'approve', note: `${TAG} looks good`,
    })
    expect((await itemRow(itemId)).posting_approval_state).toBe('approved')

    /* book it in. PUBLISH_DRY_RUN=1: the provider answers itself */
    const booked = await schedulePost(scheduler, draft.id)
    remember(booked)
    expect(booked.status).toBe('scheduled')
    expect(booked.publish_job_ids).toHaveLength(1)
    const jobId = booked.publish_job_ids[0]
    created.jobs.add(jobId)
    const job = await table<PublishJob>('publish_jobs').get(jobId, { fresh: true })
    expect(job?.content_item_id).toBe(itemId)
    // the channel it would go to is OUR row, and nobody else's
    expect((job?.targets as { accountId: string }[])[0].accountId).toBe(`zz-test-${STAMP}`)
    console.log(`[A] booked in — job ${jobId}, target zz-test-${STAMP}`)

    /* move it */
    const moved = await reschedule(scheduler, draft.id, nowPlus(3))
    expect(moved.ok).toBe(true)
    if (moved.ok) {
      remember(moved.post)
      for (const j of moved.post.publish_job_ids) created.jobs.add(j)
      expect(new Date(moved.post.scheduled_for!).getTime())
        .toBeGreaterThan(new Date(booked.scheduled_for!).getTime())
      console.log(`[A] moved (${moved.mode})`)
    }

    /* a time that has gone is refused, in words */
    const backwards = await reschedule(scheduler, draft.id, nowPlus(-1))
    expect(backwards.ok).toBe(false)
    if (!backwards.ok) expect(backwards.error).toMatch(/already gone/)

    /* cancel — and the item's gate goes with it, because the yes belonged to
       THIS post */
    const cancelled = await cancelPost(scheduler, draft.id)
    expect(cancelled.status).toBe('cancelled')
    expect((await itemRow(itemId)).posting_approval_state).toBe('draft')
    console.log('[A] cancelled — and the item’s approval was taken back with it')
  })

  it('skipping the ask: only somebody who could approve may', async () => {
    const { itemId } = await makePiece('skip the ask')
    const draft = await createPost(scheduler, {
      item_id: itemId,
      slides: SLIDES,
      caption: `${TAG} — straight out`,
      channels: [channelId],
      scheduled_for: nowPlus(4),
    })
    remember(draft)

    /* a scheduler may not skip it — they could not have approved it either */
    await expect(sendForApproval(scheduler, draft.id, { mode: 'direct' }))
      .rejects.toThrow(/account manager/)
    expect((await postRow(draft.id)).status).toBe('draft')

    /* the account manager may, and it goes THROUGH the machine: the item
       records the ask and the answer, and the post says how it was cleared */
    const straight = await sendForApproval(am, draft.id, {
      mode: 'direct', note: `${TAG} cleared by me`,
    })
    remember(straight)
    for (const j of straight.publish_job_ids) created.jobs.add(j)
    expect(straight.status).toBe('scheduled')
    expect(straight.approval_mode).toBe('self')
    expect(straight.approved_by).toBe(am.id)
    expect((await itemRow(itemId)).posting_approval_state).toBe('approved')
    console.log(`[B] booked without asking — job ${straight.publish_job_ids[0]}`)

    await cancelPost(am, draft.id)
  })

  it('a file the client has never seen makes a version and goes back to them', async () => {
    const { itemId } = await makePiece('a new file')
    const draft = await createPost(scheduler, {
      item_id: itemId,
      slides: SLIDES,
      caption: `${TAG} — with a new picture`,
      channels: [channelId],
      scheduled_for: nowPlus(5),
    })
    remember(draft)
    await sendForApproval(scheduler, draft.id)
    await actOnPostingApproval(am, (await itemRow(itemId)) as never, { action: 'approve' })
    expect((await itemRow(itemId)).posting_approval_state).toBe('approved')

    /* a REORDER is an edit of the post and nothing more */
    const reordered = await addMediaVersion(scheduler, {
      item_id: itemId, post_id: draft.id, files: [SLIDES[1], SLIDES[0]],
    })
    expect(reordered.created).toBe(false)
    expect(reordered.message).toMatch(/does not need to look again/)

    /* a genuinely NEW file is a new version, and the piece goes back */
    const added = await addMediaVersion(scheduler, {
      item_id: itemId, post_id: draft.id, files: [SLIDES[0], BROUGHT_IN],
    })
    expect(added.created).toBe(true)
    expect(added.version_number).toBe(2)
    expect(added.status).toBe('client_review')
    expect(added.message).toMatch(/client has to approve it/)

    const versions = await table<AssetVersion>('asset_versions')
      .list({ fresh: true, where: v => v.item_id === itemId })
    for (const v of versions) {
      if (!created.versions.has(v.id)) tick('asset_versions')
      created.versions.add(v.id)
    }
    expect(versions).toHaveLength(2)

    // the post kept the arrangement, and the yes given to the OLD pictures is
    // gone from both the post and the item
    const after = await postRow(draft.id)
    expect(after.status).toBe('draft')
    expect(after.sent_at).toBeNull()
    expect((await itemRow(itemId)).posting_approval_state).not.toBe('approved')
    console.log(`[C] version ${added.version_number} — the piece went back to the client`)

    // as the MANAGER: a scheduler cannot even see a piece that has gone back
    // to the client, which is the production board's own rule and exactly what
    // "the piece went back to them" is supposed to mean
    await expect(cancelPost(scheduler, draft.id)).rejects.toThrow(/not found/i)
    await cancelPost(am, draft.id)
  })

  it('editing the words of an approved post asks for the yes again', async () => {
    const { itemId } = await makePiece('an edit after the yes')
    const draft = await createPost(scheduler, {
      item_id: itemId,
      slides: SLIDES,
      caption: `${TAG} — first words`,
      channels: [channelId],
      scheduled_for: nowPlus(6),
    })
    remember(draft)
    await sendForApproval(scheduler, draft.id)
    await actOnPostingApproval(am, (await itemRow(itemId)) as never, { action: 'approve' })

    await updatePost(scheduler, draft.id, { caption: `${TAG} — different words` })
    expect((await itemRow(itemId)).posting_approval_state).not.toBe('approved')
    await expect(schedulePost(scheduler, draft.id)).rejects.toThrow()
    console.log('[D] the approval was taken back by an edit of the words')

    await cancelPost(scheduler, draft.id)
  })
})

/* ── notes ──────────────────────────────────────────────────────────────── */

describe('notes on the calendar, live', () => {
  it('the writer or an account manager may change one; nobody else', async () => {
    const mine = await addNote(editor, {
      client_id: TEST_CLIENT_ID, at: nowPlus(2), text: `${TAG} — studio booked`,
    })
    created.notes.add(mine.id)
    tick('schedule_notes')

    const listed = await listNotes(TEST_CLIENT_ID)
    expect(listed.some(n => n.id === mine.id)).toBe(true)

    /* the writer may */
    const rewritten = await editNote(editor, mine.id, { text: `${TAG} — studio booked from 9` })
    expect(rewritten.text).toMatch(/from 9/)

    /* the scheduler, who did not write it, may not — and is told why */
    await expect(editNote(scheduler, mine.id, { text: 'not mine to change' }))
      .rejects.toThrow(/Only the person who wrote this note, or an account manager/)
    await expect(removeNote(scheduler, mine.id))
      .rejects.toThrow(/Only the person who wrote this note, or an account manager/)

    /* the account manager may take anybody's */
    await removeNote(am, mine.id)
    created.notes.delete(mine.id)
    expect((await listNotes(TEST_CLIENT_ID)).some(n => n.id === mine.id)).toBe(false)

    /* an empty note is refused rather than saved blank */
    const second = await addNote(am, {
      client_id: TEST_CLIENT_ID, at: nowPlus(2), text: `${TAG} — client away`,
    })
    created.notes.add(second.id)
    tick('schedule_notes')
    await expect(editNote(am, second.id, { text: '   ' })).rejects.toThrow(/Write the note first/)
    await removeNote(am, second.id)
    created.notes.delete(second.id)
    console.log('[E] note rights held, and the refusals were sentences')
  })
})

/* ── everything back the way it was ─────────────────────────────────────── */

afterAll(async () => {
  // the fan-outs these flows start are fire-and-forget; give them a moment to
  // land so the teardown is not racing them
  await new Promise(r => setTimeout(r, 1500))

  const gone = { ...made, claim_locks: created.locks.size }

  for (const id of created.posts) await table('social_posts').remove(id).catch(() => {})
  for (const id of created.notes) await table('schedule_notes').remove(id).catch(() => {})
  for (const id of created.jobs) await table('publish_jobs').remove(id).catch(() => {})
  for (const id of created.locks) await table('claim_locks').remove(id).catch(() => {})
  for (const id of created.versions) await table('asset_versions').remove(id).catch(() => {})
  for (const id of created.items) await table('content_items').remove(id).catch(() => {})
  for (const id of created.accounts) await table('social_accounts').remove(id).catch(() => {})

  // anything the flows made that this file did not name itself
  const itemIds = [...created.items]
  const strays = await Promise.all([
    table<AssetVersion>('asset_versions').list({ fresh: true, where: v => itemIds.includes(String(v.item_id)) }),
    table<SocialPost>('social_posts').list({ fresh: true, where: p => itemIds.includes(String(p.item_id)) }),
    table<PublishJob>('publish_jobs').list({ fresh: true, where: j => itemIds.includes(String(j.content_item_id ?? '')) }),
    table<{ id: string; entity_id?: string }>('workflow_activity')
      .list({ fresh: true, where: a => itemIds.includes(String(a.entity_id ?? '')) }).catch(() => []),
    table<{ id: string; entity_id?: string }>('notification_log')
      .list({ fresh: true, where: n => itemIds.some(i => String(n.entity_id ?? '').startsWith(i)) }).catch(() => []),
  ])
  const names = ['asset_versions', 'social_posts', 'publish_jobs', 'workflow_activity', 'notification_log']
  for (let i = 0; i < strays.length; i++) {
    for (const r of strays[i]) await table(names[i] as never).remove(r.id).catch(() => {})
  }

  /* ── the read-back: nothing this file made may survive ── */
  const lockIds = [...created.locks]
  const [items, versions, posts, notes, accounts, jobs, activity, notifications, locks] = await Promise.all([
    table<ContentItem>('content_items').list({ fresh: true, where: i => String(i.title ?? '').startsWith(TAG) }),
    table<AssetVersion>('asset_versions').list({ fresh: true, where: v => itemIds.includes(String(v.item_id)) }),
    table<SocialPost>('social_posts').list({ fresh: true, where: p => itemIds.includes(String(p.item_id)) }),
    table<ScheduleNote>('schedule_notes').list({ fresh: true, where: n => String(n.text ?? '').startsWith(TAG) }),
    table<SocialAccount>('social_accounts').list({ fresh: true, where: a => String(a.provider_account_id ?? '').startsWith('zz-test-') }),
    table<PublishJob>('publish_jobs').list({ fresh: true, where: j => itemIds.includes(String(j.content_item_id ?? '')) }),
    table<{ id: string; entity_id?: string }>('workflow_activity')
      .list({ fresh: true, where: a => itemIds.includes(String(a.entity_id ?? '')) }).catch(() => []),
    table<{ id: string; entity_id?: string }>('notification_log')
      .list({ fresh: true, where: n => itemIds.some(i => String(n.entity_id ?? '').startsWith(i)) }).catch(() => []),
    // the ninth table, and the one this run writes most rows in. A lock left
    // standing makes its item unqueueable for ever — the self-healing in
    // `takeClaimLock` only fires when somebody tries again, and nobody will.
    table<{ id: string }>('claim_locks')
      .list({ fresh: true, where: l => lockIds.includes(l.id) }).catch(() => []),
  ])

  console.log('[teardown] rows created:', JSON.stringify(gone))
  console.log('[teardown] read-back leftovers —',
    'items:', items.length, 'versions:', versions.length, 'posts:', posts.length,
    'notes:', notes.length, 'accounts:', accounts.length, 'jobs:', jobs.length,
    'activity:', activity.length, 'notifications:', notifications.length,
    'locks:', locks.length)

  expect(items.map(r => r.id), 'content_items').toEqual([])
  expect(versions.map(r => r.id), 'asset_versions').toEqual([])
  expect(posts.map(r => r.id), 'social_posts').toEqual([])
  expect(notes.map(r => r.id), 'schedule_notes').toEqual([])
  expect(accounts.map(r => r.id), 'social_accounts').toEqual([])
  expect(jobs.map(r => r.id), 'publish_jobs').toEqual([])
  expect(activity.map(r => r.id), 'workflow_activity').toEqual([])
  expect(notifications.map(r => r.id), 'notification_log').toEqual([])
  expect(locks.map(r => r.id), 'claim_locks').toEqual([])
})
