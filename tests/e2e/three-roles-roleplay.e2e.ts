import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * THREE ROLES, ONE POST, THE REAL DATABASE — the journey of 8–9 Sep 2026.
 *
 *   scheduler   uploads on Post approval and asks the account manager
 *   AM          sees it, approves it, hands it to the scheduler
 *   scheduler   books ONE of its four files (dry run), marks the rest by hand
 *   super admin sees everything, at every step
 *
 * …and at every step: who can see the card (the other scheduler cannot),
 * who was told (every notification in the log, every recipient `.invalid`),
 * and where the card sits (Ready to post until the last file, then Posted).
 *
 * The three routes a screen presses are called as the screen calls them,
 * with the signed-in person swapped underneath (`h.user`) — so the gates the
 * routes keep are the gates that run. Everything else is the library.
 *
 * SAFETY: the ZZ TEST client and its `.invalid` accounts only; EMAIL_TEST_ONLY
 * (the mailer refuses a real address); PUBLISH_DRY_RUN (no socket to the
 * provider); every row this run makes is deleted at the end and read back.
 *
 *   EMAIL_TEST_ONLY=1 PUBLISH_DRY_RUN=1 \
 *     npx vitest run --config vitest.e2e.config.mts tests/e2e/three-roles-roleplay.e2e.ts
 */

const h: { user: { id: string; role: string; email: string; name: string; clerk_user_id: string | null } } = {
  user: { id: '', role: 'scheduler', email: '', name: '', clerk_user_id: null },
}
vi.mock('../../app/lib/authz', async () => {
  const real = await vi.importActual<typeof import('../../app/lib/authz')>('../../app/lib/authz')
  const ORDER = ['scheduler', 'editor', 'general', 'account_manager', 'super_admin']
  const ok = (actual: string, required: string) => {
    if (actual === 'super_admin') return true
    if (required === 'client') return actual === 'client'
    if (actual === 'client') return false
    return ORDER.indexOf(actual) >= ORDER.indexOf(required)
  }
  return {
    ...real,
    requireRole: async (required: string) => {
      if (!ok(String(h.user.role), required)) throw new real.AuthzError('Insufficient permissions', 403)
      return h.user
    },
    requireSignedIn: async () => h.user,
  }
})

import { table, withRequestCache } from '../../lib/db'
import { attachOne } from '../../lib/db-join'
import type {
  AssetVersion, ContentItem, PublishJob, SocialAccount, SocialPost, TeamUserClient,
} from '../../lib/db-types'
import type { TeamUser } from '../../app/lib/authz'
import { createPost, sendForApproval } from '../../app/lib/social-schedule'
import { performTransition } from '../../app/lib/workflow'
import { visibleItems } from '../../app/lib/scope-client'
import { pageCards, cardActions } from '../../app/lib/board-view-core'
import { postingEligibility } from '../../app/lib/social-schedule-core'
import { readPostedSlides, remainingSlides, takenSlideUrls } from '../../app/lib/posted-slides-core'
import { POST as fromUpload } from '../../app/api/social/schedule/from-upload/route'
import { POST as handoff } from '../../app/api/production/items/[id]/handoff/route'
import { POST as postedSlide } from '../../app/api/production/items/[id]/posted-slide/route'
import { POST as portalComment } from '../../app/api/portal/comment/route'
import { GET as clientComments } from '../../app/api/production/items/[id]/client-comments/route'
import { recordPublishOnItem } from '../../app/lib/production-publish'
import { putObject, deleteStoredObject } from '../../app/lib/storage'

const TEST_CLIENT_ID = '99ba2c6f-4db5-4782-9395-9048f215886c'
const IDS = {
  am: '3548cc71-5a34-4fe9-9130-11579d1a4137',
  scheduler: '0e7fcf9f-bcf5-4080-ab7c-1b1f8fed1d13',
}
/** a super admin needs no row: the libraries take the person, not a session.
 *  The id is a UUID nobody has, so a notification could never resolve to a
 *  real inbox — and a super admin is only ever the ACTOR here. */
const SUPER: TeamUser = {
  id: 'a0000000-0000-4000-8000-0000000000a1', role: 'super_admin',
  email: 'zz-superadmin@mdmedia-test.invalid', name: 'ZZ Super admin', clerk_user_id: null,
} as TeamUser
/** …and a second scheduler, who must see NONE of it */
const OTHER: TeamUser = {
  id: 'a0000000-0000-4000-8000-0000000000a2', role: 'scheduler',
  email: 'zz-other-scheduler@mdmedia-test.invalid', name: 'ZZ Other', clerk_user_id: null,
} as TeamUser

const STAMP = Date.now()
const TAG = `ZZ TEST ROLES ${STAMP}`
/** FOUR REAL FILES in our storage — the upload route HEADs each one ("not in
 *  our storage yet" otherwise), so they are put there first and taken away
 *  at the end. A few bytes each; nothing reads them as pictures. */
const SLIDES: { url: string; name: string; type: 'image'; bytes: number; source: 'upload' }[] = []
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0xff, 0xd9])

let am: TeamUser, scheduler: TeamUser
let channelId = ''
let itemId = ''
let postId = ''
const runStart = new Date().toISOString()

const created = { items: new Set<string>(), versions: new Set<string>(), posts: new Set<string>(), jobs: new Set<string>(), locks: new Set<string>(), accounts: new Set<string>(), entries: new Set<string>() }

const as = (who: TeamUser) => { Object.assign(h.user, { id: who.id, role: who.role, email: who.email, name: who.name, clerk_user_id: who.clerk_user_id ?? null }) }
const params = (id: string) => ({ params: Promise.resolve({ id }) })
const json = async (res: Response) => ({ status: res.status, body: await res.json().catch(() => ({})) })
const itemRow = async () => (await table<ContentItem>('content_items').get(itemId, { fresh: true }))!
const postsOf = async () => table<SocialPost>('social_posts').list({ fresh: true, by: { item_id: itemId } as never })

/** every notification about this item, since the run began */
async function toldAbout(): Promise<{ recipient_email: string; subject: string; event_type: string; entity_id: string }[]> {
  const rows = await table<{ id: string; entity_id?: string; recipient_email?: string; subject?: string; event_type?: string; created_at?: string; status?: string; error?: string }>('notification_log')
    .list({ fresh: true, where: n => String(n.created_at ?? '') >= runStart && (String(n.entity_id ?? '').includes(itemId) || String(n.recipient_email ?? '').endsWith('.invalid')) })
  // With nobody flagged as the quality reviewer the super admins stand in
  // for her, and the kill switch REFUSES their rows before any mail moves;
  // a refused row is the switch working, not a leak (11 Sep 2026). Nothing
  // to a real address may ever be 'sent' — that is checked here, every time.
  const leaked = rows.filter(r => !String(r.recipient_email ?? '').endsWith('.invalid') && String(r.status ?? '') === 'sent')
  if (leaked.length > 0) throw new Error(`a real inbox was emailed: ${leaked.map(r => r.recipient_email).join(', ')}`)
  return rows
    .filter(r => !/EMAIL_TEST_ONLY/.test(String(r.error ?? '')))
    .map(r => ({ recipient_email: String(r.recipient_email ?? ''), subject: String(r.subject ?? ''), event_type: String(r.event_type ?? ''), entity_id: String(r.entity_id ?? '') }))
}
let assignments: TeamUserClient[] = []
const seenBy = (who: TeamUser, rows: ContentItem[]) =>
  visibleItems({ id: who.id, role: who.role } as never, rows as never, assignments as never, { schedulerPostFilter: false }).map(r => r.id)

beforeAll(() => withRequestCache(async () => {
  if (process.env.EMAIL_TEST_ONLY !== '1') throw new Error('EMAIL_TEST_ONLY is not set — refusing to run')
  process.env.PUBLISH_DRY_RUN = '1'
  const client = await table<{ id: string; name: string }>('clients').get(TEST_CLIENT_ID)
  if (!client || !/^ZZ TEST/.test(client.name)) throw new Error('ZZ TEST client not found')
  const people = await table<TeamUser & { id: string }>('team_users').list({ where: u => u.id === IDS.am || u.id === IDS.scheduler })
  am = people.find(u => u.id === IDS.am)!; scheduler = people.find(u => u.id === IDS.scheduler)!
  if (!am || !scheduler) throw new Error('Test accounts missing')
  for (const p of [am, scheduler]) if (!p.email.endsWith('.invalid')) throw new Error(`refusing: ${p.email} is real`)
  const links = await table<TeamUserClient>('team_user_clients').list({ by: { client_id: TEST_CLIENT_ID } })
  assignments = links
  const emails = (await attachOne(links, 'team_user_id', 'team_users', ['email'])).map(r => (r.team_users as { email: string } | null)?.email).filter((e): e is string => !!e)
  if (emails.some(e => !e.endsWith('.invalid'))) throw new Error('ZZ TEST client is managed by real people')

  const account = await table<SocialAccount>('social_accounts').insert({
    client_id: TEST_CLIENT_ID, platform: 'instagram', provider_account_id: `zz-test-${STAMP}`,
    name: `${TAG} channel`, username: `zz_test_${STAMP}`, avatar_url: null, active: true,
    connected_at: new Date().toISOString(), last_synced_at: new Date().toISOString(),
  } as never)
  created.accounts.add(account.id); channelId = account.id
  for (const n of ['one', 'two', 'three', 'four']) {
    const put = await putObject(`zztest-${STAMP}-${n}.jpg`, JPEG, 'image/jpeg')
    SLIDES.push({ url: put.publicUrl, name: `${n}.jpg`, type: 'image', bytes: JPEG.length, source: 'upload' })
  }
  console.log(`[setup] client=${TEST_CLIENT_ID} channel=${channelId} files=${SLIDES.length} in storage`)
}))

describe('three roles, one post, live', () => {
  it('1. the scheduler uploads on Post approval and asks the account manager', async () => {
    as(scheduler)
    const r = await json(await fromUpload(new Request('https://x.test/from-upload', {
      method: 'POST',
      body: JSON.stringify({ client_id: TEST_CLIENT_ID, files: SLIDES, title: `${TAG} — four photos`, decision: 'ask', reviewer_ids: [am.id], note: 'Two options, pick one' }),
    })))
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    itemId = String(r.body.item_id); created.items.add(itemId)
    postId = String(r.body.post?.id ?? ''); if (postId) { created.posts.add(postId); created.locks.add(`social_post__${itemId}`); created.locks.add(`publish__${itemId}`) }
    for (const v of await table<AssetVersion>('asset_versions').list({ fresh: true, by: { item_id: itemId } as never })) created.versions.add(v.id)
    const item = await itemRow()
    // Abby's rule (11 Sep 2026): the upload lands at the quality check, with the named manager asked
    expect(item.status).toBe('quality_check')
    expect(item.owner_id).toBe(scheduler.id)
    expect((item as { asked_ids?: string[] }).asked_ids).toEqual([am.id])
    expect((item as { adhoc_post?: boolean }).adhoc_post).toBe(true)
    console.log(`[1] card ${itemId} in Quality check, asked ${am.email}`)

    // on the new road the reviewers are told first (real super admins stand in
    // when nobody is flagged, each refused slowly by the kill switch), then Ops,
    // then the named manager — so wait for the manager's row rather than read once
    const deadline = Date.now() + 120_000
    let told = await toldAbout()
    while (!told.some(t => t.recipient_email === am.email) && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 300))
      told = await toldAbout()
    }
    expect(told.length).toBeGreaterThan(0)
    expect(told.every(t => t.recipient_email.endsWith('.invalid'))).toBe(true)
    expect(told.some(t => t.recipient_email === am.email)).toBe(true)
    console.log(`[1] told: ${told.map(t => `${t.recipient_email} (${t.event_type})`).join(', ')}`)
  })

  it('2. who sees it: the scheduler, the AM, the super admin — not another scheduler', async () => {
    const rows = [await itemRow()]
    console.log(`[2] card owner=${rows[0].owner_id} status=${rows[0].status} scheduler=${scheduler.id}`)
    expect(seenBy(scheduler, rows)).toEqual([itemId])
    expect(seenBy(am, rows)).toEqual([itemId])
    expect(seenBy(SUPER, rows)).toEqual([itemId])
    expect(seenBy(OTHER, rows)).toEqual([])
    // and on the Post approval board it is in Internal check for all three
    for (const who of [scheduler, am, SUPER]) {
      const cards = pageCards('scheduler', rows as never, { id: who.id, role: who.role } as never)
      expect(cards.map(c => c.id)).toEqual([itemId])
    }
    // the manager's buttons say Approve; the scheduler's do not
    const card = rows[0] as never
    const amActs = cardActions(card, { id: am.id, role: 'account_manager' } as never)
    console.log('[2] AM actions:', JSON.stringify([amActs.primary, ...amActs.more]))
    console.log('[2] scheduler actions:', JSON.stringify((() => { const a = cardActions(card, { id: scheduler.id, role: 'scheduler' } as never); return [a.primary, ...a.more] })()))
    // the gate (11 Sep 2026): at Quality check the AM may only send it back, never approve or pass
    expect([amActs.primary, ...amActs.more].some(a => a?.kind === 'send_back')).toBe(true)
    expect([amActs.primary, ...amActs.more].some(a => a?.kind === 'transition' && a.to === 'quality_check')).toBe(false)
    expect([amActs.primary, ...amActs.more].some(a => a?.kind === 'transition' && a.to === 'approved_for_scheduling')).toBe(false)
    const schActs = cardActions(card, { id: scheduler.id, role: 'scheduler' } as never)
    expect([schActs.primary, ...schActs.more].some(a => a?.kind === 'transition' && a.to === 'approved_for_scheduling')).toBe(false)
    console.log('[2] visibility and buttons are right for all four people')
  })

  it('2b. the AM sends it to the client; the client comments on one photo from the portal; only the AM reads it', async () => {
    as(am)
    const before = (await toldAbout()).length
    // the card is already at the quality check; the super admin, standing in
    // for the quality reviewer, sends it to the client (Abby's rule, 11 Sep 2026)
    expect((await itemRow()).status).toBe('quality_check')
    const sent = await performTransition(SUPER, (await itemRow()) as never, 'client_review', { note: 'Have a look' })
    expect(sent.status).toBe('client_review')
    await new Promise(r => setTimeout(r, 1000))
    const told = (await toldAbout()).slice(before)
    expect(told.every(t => t.recipient_email.endsWith('.invalid'))).toBe(true)
    console.log(`[2b] sent to client; told: ${told.map(t => `${t.recipient_email} "${t.subject}"`).join(', ')}`)

    // the client, on their portal, about photo 2 of 4
    const client = await table<{ id: string; share_token: string | null }>('clients').get(TEST_CLIENT_ID)
    const c = await json(await portalComment(new Request('https://x.test/portal/comment', {
      method: 'POST', body: JSON.stringify({ token: client!.share_token, kind: 'item', id: itemId, body: 'On photo 2 of 4: can the logo be bigger?', author_name: 'ZZ Client' }),
    })))
    expect(c.status, JSON.stringify(c.body)).toBe(200)

    // the AM reads it; the scheduler is refused the client's own words
    as(am)
    const mine = await json(await clientComments(new Request('https://x.test/client-comments'), params(itemId)))
    expect(mine.status).toBe(200)
    expect((mine.body.comments as { body: string }[]).some(x => /photo 2 of 4/.test(x.body))).toBe(true)
    as(scheduler)
    const theirs = await json(await clientComments(new Request('https://x.test/client-comments'), params(itemId)))
    expect(theirs.status).toBe(403)
    console.log('[2b] the client’s comment reached the AM and not the scheduler')
  })

  it('3. the AM logs the client’s approval, then hands it to the scheduler — the scheduler is told, nobody else', async () => {
    as(am)
    // the approval. With nobody handed the card yet, the live rule tells EVERY
    // active scheduler — and one of those is a real person, whom this run
    // must not email — so that one audience is skipped here; the hand-over
    // below is the message the scheduler actually works from.
    const approved = await performTransition(am, (await itemRow()) as never, 'approved_for_scheduling', { note: 'Good to go', skipAudiences: ['assigned_schedulers', 'schedulers'] as never })
    expect(approved.status).toBe('approved_for_scheduling')

    const before = (await toldAbout()).length
    const handed = await json(await handoff(new Request('https://x.test/handoff', { method: 'POST', body: JSON.stringify({ scheduler_ids: [scheduler.id], note: 'Yours to post' }) }), params(itemId)))
    expect(handed.status, JSON.stringify(handed.body)).toBe(200)
    expect((await itemRow()).scheduler_ids).toEqual([scheduler.id])
    // the fan-out is fire-and-forget and the mailer is slow per refused
    // address: wait for the scheduler's row rather than read once
    const deadline = Date.now() + 120_000
    let told = (await toldAbout()).slice(before)
    while (!told.some(t => t.recipient_email === scheduler.email) && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 300))
      told = (await toldAbout()).slice(before)
    }
    expect(told.every(t => t.recipient_email.endsWith('.invalid'))).toBe(true)
    expect(told.some(t => t.recipient_email === scheduler.email)).toBe(true)
    console.log(`[3] approved and handed; told: ${told.map(t => `${t.recipient_email} "${t.subject}" ${t.entity_id}`).join(', ')}`)
  })

  it('4. the scheduler sees the folder with four free files, and books ONE (dry run)', async () => {
    const item = await itemRow()
    const versions = await table<AssetVersion>('asset_versions').list({ fresh: true, by: { item_id: itemId } as never })
    const elig = postingEligibility(item as never, versions as never, false)
    expect(elig.ok).toBe(true)
    const free = elig.ok ? remainingSlides(elig.slides, takenSlideUrls(await postsOf())) : []
    expect(free).toHaveLength(4)

    as(scheduler)
    console.log('[4] posts on the piece before booking:', JSON.stringify((await postsOf()).map(p => ({ id: p.id, status: p.status, slides: (Array.isArray(p.slides) ? p.slides : []).length }))))
    const draft = await createPost(scheduler, { item_id: itemId, slides: [free[0]], caption: `${TAG} first one`, channels: [channelId], scheduled_for: new Date(Date.now() + 2 * 86_400_000).toISOString() })
    created.posts.add(draft.id)
    const booked = await sendForApproval(scheduler, draft.id, { mode: 'direct' })
    for (const j of booked.publish_job_ids) created.jobs.add(j)
    expect(booked.status).toBe('scheduled')
    expect(booked.approval_mode).toBe('assets')
    expect(booked.publish_job_ids).toHaveLength(1)
    const job = await table<PublishJob>('publish_jobs').get(booked.publish_job_ids[0], { fresh: true })
    expect((job?.targets as { accountId: string }[])[0].accountId).toBe(`zz-test-${STAMP}`)
    for (const e of await table<{ id: string; item_id: string }>('schedule_entries').list({ fresh: true, by: { item_id: itemId } as never })) created.entries.add(e.id)

    // the card did NOT move: three files are still free
    expect((await itemRow()).status).toBe('approved_for_scheduling')
    const left = elig.ok ? remainingSlides(elig.slides, takenSlideUrls(await postsOf())) : []
    expect(left).toHaveLength(3)
    // the AM was told it is booked
    await new Promise(r => setTimeout(r, 1500))
    const told = await toldAbout()
    expect(told.some(t => t.recipient_email === am.email && /Booked in/.test(t.subject))).toBe(true)
    console.log(`[4] one file booked (job ${booked.publish_job_ids[0]}), card stays in Ready to post, 3 files free; AM told`)
  })

  it('5. the scheduler marks the other three posted by hand — the card moves only on the last', async () => {
    as(scheduler)
    const versions = await table<AssetVersion>('asset_versions').list({ fresh: true, by: { item_id: itemId } as never })
    const item = await itemRow()
    const elig = postingEligibility(item as never, versions as never, false)
    const free = elig.ok ? remainingSlides(elig.slides, takenSlideUrls(await postsOf())) : []
    expect(free).toHaveLength(3)
    const when = new Date(Date.now() - 3_600_000).toISOString()
    for (let i = 0; i < 3; i++) {
      const r = await json(await postedSlide(new Request('https://x.test/posted-slide', { method: 'POST', body: JSON.stringify({ url: free[i].url, posted_at: when, live_url: i === 0 ? 'https://www.instagram.com/p/zztest/' : null }) }), params(itemId)))
      expect(r.status, JSON.stringify(r.body)).toBe(200)
      const row = await itemRow()
      const ps = readPostedSlides((row as { posted_slides?: unknown }).posted_slides)!
      expect(ps.posted).toBe(i + 1)
      expect(ps.hand?.find(h => h.url === free[i].url)?.at).toBe(when)
      // three by hand + one booked-but-not-out = not yet Posted
      expect(row.status).toBe('approved_for_scheduling')
    }
    console.log('[5] three marked by hand with a time; the card waits for the booked one')

    // the provider says the booked one went out (what the sync writes), and the card completes
    const job = (await postsOf()).flatMap(p => (Array.isArray(p.publish_job_ids) ? p.publish_job_ids : []) as string[])[0]
    await table('publish_jobs').update(job, { status: 'published', published_at: new Date().toISOString() })
    await recordPublishOnItem(itemId, 'https://www.instagram.com/p/zztest-live/', ['instagram'])
    const done = await itemRow()
    expect(done.status).toBe('published')
    expect(readPostedSlides((done as { posted_slides?: unknown }).posted_slides)?.posted).toBe(4)
    for (const e of await table<{ id: string; item_id: string }>('schedule_entries').list({ fresh: true, by: { item_id: itemId } as never })) created.entries.add(e.id)
    console.log('[5] the last file went out — the card is Posted, 4 of 4')
  })

  it('6. the super admin sees the whole story; the other scheduler still sees nothing', async () => {
    const rows = [await itemRow()]
    expect(seenBy(SUPER, rows)).toEqual([itemId])
    expect(seenBy(am, rows)).toEqual([itemId])
    expect(seenBy(scheduler, rows)).toEqual([itemId])
    expect(seenBy(OTHER, rows)).toEqual([])
    const told = await toldAbout()
    expect(told.every(t => t.recipient_email.endsWith('.invalid'))).toBe(true)
    console.log(`[6] ${told.length} notifications, every one to a .invalid address:`)
    for (const t of told) console.log(`     ${t.recipient_email}  ${t.event_type}  "${t.subject}"`)
  })
})

afterAll(async () => {
  await new Promise(r => setTimeout(r, 1500))
  for (const id of created.posts) await table('social_posts').remove(id).catch(() => {})
  for (const id of created.jobs) await table('publish_jobs').remove(id).catch(() => {})
  for (const id of created.locks) await table('claim_locks').remove(id).catch(() => {})
  for (const id of created.entries) await table('schedule_entries').remove(id).catch(() => {})
  for (const id of created.versions) await table('asset_versions').remove(id).catch(() => {})
  for (const id of created.items) await table('content_items').remove(id).catch(() => {})
  for (const id of created.accounts) await table('social_accounts').remove(id).catch(() => {})
  for (const s of SLIDES) await deleteStoredObject(s.url).catch(() => {})
  const ids = [...created.items]
  const strays = await Promise.all([
    table<AssetVersion>('asset_versions').list({ fresh: true, where: v => ids.includes(String(v.item_id)) }),
    table<SocialPost>('social_posts').list({ fresh: true, where: p => ids.includes(String(p.item_id)) }),
    table<PublishJob>('publish_jobs').list({ fresh: true, where: j => ids.includes(String(j.content_item_id ?? '')) }),
    table<{ id: string; item_id?: string }>('schedule_entries').list({ fresh: true, where: e => ids.includes(String(e.item_id ?? '')) }).catch(() => []),
    table<{ id: string; entity_id?: string }>('workflow_activity').list({ fresh: true, where: a => ids.includes(String(a.entity_id ?? '')) }).catch(() => []),
    table<{ id: string; entity_id?: string }>('notification_log').list({ fresh: true, where: n => ids.some(i => String(n.entity_id ?? '').includes(i)) }).catch(() => []),
    table<{ id: string; item_id?: string }>('item_comments').list({ fresh: true, where: c => ids.includes(String(c.item_id ?? '')) }).catch(() => []),
  ])
  const names = ['asset_versions', 'social_posts', 'publish_jobs', 'schedule_entries', 'workflow_activity', 'notification_log', 'item_comments']
  for (let i = 0; i < strays.length; i++) for (const r of strays[i]) await table(names[i] as never).remove(r.id).catch(() => {})
  const left = await Promise.all([
    table<ContentItem>('content_items').list({ fresh: true, where: i => String(i.title ?? '').startsWith(TAG) }),
    table<SocialAccount>('social_accounts').list({ fresh: true, where: a => String(a.provider_account_id ?? '') === `zz-test-${STAMP}` }),
    table<SocialPost>('social_posts').list({ fresh: true, where: p => ids.includes(String(p.item_id)) }),
  ])
  console.log(`[teardown] left behind: items=${left[0].length} accounts=${left[1].length} posts=${left[2].length}`)
  expect(left.every(l => l.length === 0)).toBe(true)
})
