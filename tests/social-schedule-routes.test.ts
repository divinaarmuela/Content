import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import { table } from '@/lib/db'
import type { Row } from '@/lib/db-types'

/**
 * The Schedule page's server, on the real `@/lib/db` over an in-memory Realtime Database: create a post,
 * save its working copy, move it on the calendar, put it in the bin — and every other move through
 * `POST /api/posts/<id>/act`, the one route that moves a post (the posting rebuild, 29 Sep 2026).
 *
 * The old model — one approval per ITEM (`posting_approval_state`), a post's status worked out from the
 * item and its jobs, "send for approval" and "schedule without approval" doors — is gone, and so are its
 * tests. The rules now live in app/lib/post-stage-core.ts (tests/post-stage-core.test.ts) and the writer in
 * app/lib/post-stage.ts (tests/post-stage.test.ts). What stays here is what this page's own routes do.
 *
 * Nothing here may reach a real account: PUBLISH_DRY_RUN=1 makes the provider itself answer with a fake
 * id, and the only fetch in the process is the fake database.
 */

const h = vi.hoisted(() => ({
  user: { id: '', role: '', email: '', name: '', clerk_user_id: null } as Record<string, unknown>,
}))

vi.mock('../app/lib/authz', () => {
  class AuthzError extends Error {
    status: number
    constructor(message: string, status: number) { super(message); this.status = status }
  }
  const ORDER = ['scheduler', 'editor', 'account_manager', 'super_admin']
  const ok = (actual: string, required: string) => {
    if (actual === 'super_admin') return true
    if (required === 'client') return actual === 'client'
    if (actual === 'client') return false
    return ORDER.indexOf(actual) >= ORDER.indexOf(required)
  }
  return {
    AuthzError,
    authzErrorResponse: (e: unknown) => (e instanceof AuthzError
      ? { error: e.message, status: e.status }
      : { error: e instanceof Error ? e.message : 'error', status: 500 }),
    requireRole: async (required: string) => {
      if (!ok(String(h.user.role), required)) throw new AuthzError('Insufficient permissions', 403)
      return h.user
    },
    requireSignedIn: async () => h.user,
  }
})
vi.mock('../app/lib/mailer', () => ({
  notify: vi.fn(), renderEmail: () => '', escapeHtml: (s: string) => s,
}))
vi.mock('../app/lib/gdrive-mirror', () => ({
  mirrorLatestVersionSoon: vi.fn(), mirrorVersionSlides: vi.fn(async () => []),
}))
vi.mock('../app/lib/production-live', () => ({
  announceItemChange: vi.fn(), announceBatchChange: vi.fn(),
}))
vi.mock('../lib/live', () => ({ announce: vi.fn(), announceAfter: vi.fn() }))
vi.mock('../app/inngest/client', () => ({ inngest: { send: vi.fn(async () => ({})) } }))

const schedule = await import('../app/api/social/schedule/route')
const one = await import('../app/api/social/schedule/[id]/route')
const move = await import('../app/api/social/schedule/[id]/reschedule/route')
const actRoute = await import('../app/api/posts/[id]/act/route')
const notesRoute = await import('../app/api/social/schedule/notes/route')
const suggested = await import('../app/api/social/schedule/suggested/route')
const channelOptions = await import('../app/api/social/schedule/options/route')
const lib = await import('../app/lib/social-schedule')
const transition = await import('../app/api/production/items/[id]/transition/route')
const clientApproval = await import('../app/api/clients/[id]/approval/route')

/* ── the cast ───────────────────────────────────────────────────────────── */

const CLIENT = 'c1'
const ITEM = 'a1b2c3d4-0000-4000-8000-000000000001'
const AM = { id: 'u-am', role: 'account_manager', email: 'am@x.invalid', name: 'Ada', clerk_user_id: null }
const SCHEDULER = { id: 'u-sch', role: 'scheduler', email: 'sch@x.invalid', name: 'Sam', clerk_user_id: null }
const OWNER = { id: 'u-ed', role: 'editor', email: 'ed@x.invalid', name: 'Eden', clerk_user_id: null }
const STRANGER = { id: 'u-ed2', role: 'editor', email: 'ed2@x.invalid', name: 'Kit', clerk_user_id: null }

/** the quality reviewer's hat is a flag, so it has to be put DOWN between people */
const as = (who: typeof AM & { quality_reviewer?: boolean }) => { Object.assign(h.user, { quality_reviewer: false }, who) }
/** Ada again, flagged as the quality reviewer (Joy's hat on a manager) */
const QA = { ...AM, quality_reviewer: true }

const SLIDES = [
  { url: 'https://media.mdmmarketing.com.au/one.jpg', name: 'one.jpg', type: 'image' },
  { url: 'https://media.mdmmarketing.com.au/two.jpg', name: 'two.jpg', type: 'image' },
]

const IN_TWO_DAYS = () => new Date(Date.now() + 2 * 86_400_000).toISOString()
const IN_THREE_DAYS = () => new Date(Date.now() + 3 * 86_400_000).toISOString()

let fake: ReturnType<typeof seedDb>

function seed(
  itemPatch: Record<string, unknown> = {},
  clientPatch: Record<string, unknown> = {},
) {
  return seedDb({
    clients: [{
      id: CLIENT, name: 'Acme', timezone: 'Australia/Melbourne', ...clientPatch,
    }] as unknown as Row[],
    content_items: [{
      id: ITEM, client_id: CLIENT, title: 'The launch post', status: 'approved_for_scheduling',
      // handed to the scheduler: since 9 Sep 2026 a scheduler sees only the cards that are theirs
      content_type: 'carousel', owner_id: OWNER.id, scheduler_ids: [SCHEDULER.id], caption: 'Hello',
      posting_approval_state: null, platform_targets: ['instagram'],
      ...itemPatch,
    }] as unknown as Row[],
    asset_versions: [{
      id: 'v1', item_id: ITEM, version_number: 1, files: SLIDES,
      file_url: SLIDES[0].url, dropbox_url: '', drive_url: '', notes: null, uploaded_by: OWNER.id,
    }] as unknown as Row[],
    social_accounts: [{
      id: 'acc-1', client_id: CLIENT, platform: 'instagram', provider_account_id: 'prov-1',
      name: 'Acme on Instagram', username: 'acme', avatar_url: null, active: true,
    }] as unknown as Row[],
    team_users: [AM, SCHEDULER, OWNER, STRANGER].map(u => ({
      ...u, active_status: true, employment_type: 'employee',
      timezone: 'Australia/Melbourne', client_id: null,
    })) as unknown as Row[],
    team_user_clients: [AM, OWNER, STRANGER].map(u => ({
      id: `${u.id}__${CLIENT}`, team_user_id: u.id, client_id: CLIENT,
    })) as unknown as Row[],
    social_posts: [],
    post_versions: [],
    post_events: [],
    schedule_entries: [],
    schedule_notes: [],
    publish_jobs: [],
    claim_locks: [],
    post_analytics: [],
  })
}

const json = async (res: Response | Promise<Response>) => {
  const r = await res
  return { status: r.status, body: await r.json() as any }
}

const create = (body: Record<string, unknown> = {}) => json(
  schedule.POST(new Request('https://x.test/api/social/schedule', {
    method: 'POST',
    body: JSON.stringify({
      item_id: ITEM, slides: SLIDES, caption: 'Hello everyone',
      channels: ['acc-1'], scheduled_for: IN_TWO_DAYS(), ...body,
    }),
  })),
)

const params = (id: string) => ({ params: Promise.resolve({ id }) })

const row = (id: string) => fake.rows('social_posts').find(p => p.id === id) as any
const jobs = () => fake.rows('publish_jobs') as any[]

/** one move on the post, with the rev (and version) the page would have drawn */
const act = async (id: string, action: string, extra: Record<string, unknown> = {}) => json(
  actRoute.POST(new Request('https://x.test/act', {
    method: 'POST',
    body: JSON.stringify({ action, expect_rev: row(id)?.rev ?? 0, version: row(id)?.sent_version ?? undefined, ...extra }),
  }), params(id)))

const moveTo = (id: string, at: string) => json(
  move.POST(new Request('https://x.test/reschedule', { method: 'POST', body: JSON.stringify({ at }) }), params(id)))
const bin = (id: string) => json(one.DELETE(new Request('https://x.test/x', { method: 'DELETE' }), params(id)))
const save = (id: string, body: Record<string, unknown>) => json(
  one.PATCH(new Request('https://x.test/post', { method: 'PATCH', body: JSON.stringify(body) }), params(id)))

/** made by the scheduler, checked by the quality reviewer: Ready to post */
async function readyPost(body: Record<string, unknown> = {}) {
  as(SCHEDULER)
  const id = (await create(body)).body.post.id as string
  const sent = await act(id, 'send_to_qc')
  expect(sent.status, JSON.stringify(sent.body)).toBe(200)
  as(QA)
  const passed = await act(id, 'pass')
  expect(passed.status, JSON.stringify(passed.body)).toBe(200)
  as(SCHEDULER)
  return id
}

beforeEach(() => {
  process.env.PUBLISH_DRY_RUN = '1'
  process.env.ZERNIO_API_KEY = 'not-used-in-a-dry-run'
  as(SCHEDULER)
  fake = seed()
})
afterEach(() => {
  fake.restore()
  delete process.env.PUBLISH_DRY_RUN
  vi.clearAllMocks()
})

/* ── the whole way through ──────────────────────────────────────────────── */

describe('a planned post, end to end', () => {
  it('create → send for quality check → passed → book in → move → bin', async () => {
    const made = await create()
    expect(made.status).toBe(200)
    expect(made.body.post.stage).toBe('draft')
    expect(made.body.post.slides).toHaveLength(2)
    const id = made.body.post.id as string

    // a draft cannot be booked
    expect((await act(id, 'book')).status).toBe(409)

    const sent = await act(id, 'send_to_qc')
    expect(sent.status, JSON.stringify(sent.body)).toBe(200)
    expect(sent.body.post.stage).toBe('quality_check')
    // the EDIT card never moves for the post (SPEC §1.3)
    expect((fake.rows('content_items')[0] as any).status).toBe('approved_for_scheduling')

    as(QA)
    const passed = await act(id, 'pass')
    expect(passed.status).toBe(200)
    expect(passed.body.words).toBe('Passed — now in Ready to post')
    // …and nothing was booked by the pass: booking is its own press
    expect(jobs()).toHaveLength(0)

    as(SCHEDULER)
    const booked = await act(id, 'book')
    expect(booked.status, JSON.stringify(booked.body)).toBe(200)
    expect(booked.body.post.stage).toBe('booked')
    expect(jobs()).toHaveLength(1)
    expect(jobs()[0].content_item_id).toBe(ITEM)
    expect(jobs()[0].targets[0]).toMatchObject({ platform: 'instagram', accountId: 'prov-1' })
    expect(row(id).booking.job_ids).toEqual([jobs()[0].id])

    // a second Book in press is refused; still one job
    expect((await act(id, 'book')).status).toBe(409)
    expect(jobs()).toHaveLength(1)

    // move it: the provider is holding this one, so the old job is pulled back and a new one made
    const later = IN_THREE_DAYS()
    const moved = await moveTo(id, later)
    expect(moved.status, JSON.stringify(moved.body)).toBe(200)
    expect(moved.body.post.scheduled_for).toBe(later)
    expect(moved.body.post.stage).toBe('booked')
    expect(jobs().filter(j => j.status === 'cancelled')).toHaveLength(1)
    expect(jobs().filter(j => j.status === 'queued')).toHaveLength(1)

    // and take it off the calendar: a sent post is cancelled, never deleted
    const gone = await bin(id)
    expect(gone.status, JSON.stringify(gone.body)).toBe(200)
    expect(gone.body.post.stage).toBe('cancelled')
    expect(jobs().every(j => j.status === 'cancelled')).toBe(true)
  })

  it('moves a draft with one write, and never onto a time that has gone', async () => {
    const id = (await create()).body.post.id as string
    const later = IN_THREE_DAYS()
    const moved = await moveTo(id, later)
    expect(moved.status).toBe(200)
    expect(row(id).scheduled_for).toBe(later)
    expect(row(id).stage).toBe('draft')
    expect(jobs()).toHaveLength(0)

    const past = await moveTo(id, new Date(Date.now() - 3600_000).toISOString())
    expect(past.status).toBe(409)
    expect(past.body.error).toBe('That time has already gone — pick a later one')
  })

  it('keeps the approval when only the time moves (SPEC T13)', async () => {
    const id = await readyPost()
    const later = IN_THREE_DAYS()
    const moved = await moveTo(id, later)
    expect(moved.status, JSON.stringify(moved.body)).toBe(200)
    expect(moved.body.post.stage).toBe('ready')
    expect(moved.body.post.approval.version).toBe(moved.body.post.sent_version)
    // …a time-only PATCH does the same
    const again = await save(id, { scheduled_for: IN_TWO_DAYS() })
    expect(again.status, JSON.stringify(again.body)).toBe(200)
    expect(row(id).stage).toBe('ready')
  })

  it('refuses to change the words of a post that was sent — press Edit first', async () => {
    const id = await readyPost()
    const r = await save(id, { caption: 'Different words' })
    expect(r.status).toBe(409)
    expect(String(r.body.error)).toMatch(/Press Edit/)
    expect(row(id).caption).toBe('Hello everyone')
    // Edit makes it a draft of the next version; then the words may change
    expect((await act(id, 'edit')).status).toBe(200)
    expect((await save(id, { caption: 'Different words' })).status).toBe(200)
    expect(row(id).caption).toBe('Different words')
    expect(row(id).stage).toBe('draft')
  })

  it('the bin deletes a draft that was never sent', async () => {
    const id = (await create()).body.post.id as string
    const gone = await bin(id)
    expect(gone.status).toBe(200)
    expect(gone.body.stage).toBe('deleted')
    expect(row(id)).toBeUndefined()
    // …and the piece may carry a new post of the same files straight away
    expect((await create()).status).toBe(200)
  })

  it('refuses graphics that are not part of the approved version', async () => {
    const bad = await create({
      slides: [{ url: 'https://elsewhere.invalid/sneaky.jpg', name: 'sneaky.jpg', type: 'image' }],
    })
    expect(bad.status).toBe(400)
    expect(bad.body.error).toContain('approved version')
    expect(fake.rows('social_posts')).toHaveLength(0)
  })

  it('starts one post per item, however many times the button is pressed', async () => {
    const [a, b] = await Promise.all([create(), create()])
    expect([a, b].filter(r => r.status === 200)).toHaveLength(1)
    expect(fake.rows('social_posts')).toHaveLength(1)
  })

  it('a fresh post after a cancelled one is a draft of its own', async () => {
    const a = await readyPost()
    expect((await bin(a)).body.post.stage).toBe('cancelled')
    const made = await create()
    expect(made.status).toBe(200)
    expect(made.body.post.stage).toBe('draft')
    expect(row(a).stage).toBe('cancelled')
  })
})

/* ── who may ────────────────────────────────────────────────────────────── */

describe('roles', () => {
  it('an editor moves no post (the owner, decision 7)', async () => {
    const id = (await create()).body.post.id as string
    as(OWNER)
    const r = await act(id, 'send_to_qc')
    expect(r.status).toBe(403)
    expect(row(id).stage).toBe('draft')
  })

  it('refuses an editor on somebody else’s item', async () => {
    as(STRANGER)
    const made = await create()
    expect(made.status).toBe(403)
    expect(fake.rows('social_posts')).toHaveLength(0)
  })

  it('refuses a client outright', async () => {
    as({ ...OWNER, role: 'client' } as typeof AM)
    expect((await create()).status).toBe(403)
  })
})

/* ── TikTok's tick, judged with the options the composer actually holds ── */

describe('the TikTok tick', () => {
  const withTikTok = () => {
    const tables = (fake.tree() as any).mdm.tables
    tables.social_accounts['acc-tt'] = {
      id: 'acc-tt', client_id: CLIENT, platform: 'tiktok', provider_account_id: 'prov-tt',
      name: 'Acme on TikTok', username: 'acme', avatar_url: null, active: true,
    }
  }

  it('a DRAFT saves without the tick — nothing is going out yet', async () => {
    withTikTok()
    const made = await create({ channels: ['acc-1', 'acc-tt'] })
    expect(made.status).toBe(200)
    expect(made.body.post.stage).toBe('draft')
  })

  it('…and the send for quality check asks for it, before anybody looks at the post', async () => {
    withTikTok()
    const made = await create({ channels: ['acc-1', 'acc-tt'] })
    const sent = await act(made.body.post.id as string, 'send_to_qc')
    expect(sent.status).toBe(409)
    expect(String(sent.body.reason) + JSON.stringify(sent.body.problems ?? [])).toMatch(/TikTok/)
    expect(row(made.body.post.id).stage).toBe('draft')
  })

  it('a ticked box is a ticked box — the post goes to the check', async () => {
    withTikTok()
    const made = await create({
      channels: ['acc-1', 'acc-tt'],
      per_channel: { 'acc-tt': { tiktokConsent: true } },
    })
    expect(made.status).toBe(200)
    const sent = await act(made.body.post.id as string, 'send_to_qc')
    expect(sent.status, JSON.stringify(sent.body)).toBe(200)
  })
})

/* ── the cover the editor saved ─────────────────────────────────────────── */

describe('the cover picture reaches the provider', () => {
  const COVER = 'https://media.mdmmarketing.com.au/one_cover.jpg'

  /** book a post in and hand back the targets that were queued */
  const bookAndRead = async (body: Record<string, unknown> = {}) => {
    const id = await readyPost(body)
    const booked = await act(id, 'book')
    expect(booked.status, JSON.stringify(booked.body)).toBe(200)
    return (jobs()[0] as any).targets as any[]
  }

  it('sends the version’s cover as the post’s cover picture', async () => {
    // the editor writes it on the version, not on the post
    await table('asset_versions').update('v1', { cover_url: COVER })
    const targets = await bookAndRead()
    expect(targets).toHaveLength(1)
    expect(targets[0].options?.thumbnailUrl).toBe(COVER)
  })

  it('leaves the post alone when no cover was ever chosen', async () => {
    const targets = await bookAndRead()
    expect(targets[0]?.options?.thumbnailUrl).toBeUndefined()
  })

  it('never overrides a cover somebody typed in for that channel', async () => {
    await table('asset_versions').update('v1', { cover_url: COVER })
    const mine = 'https://media.mdmmarketing.com.au/typed_in.jpg'
    const targets = await bookAndRead({
      per_channel: { 'acc-1': { thumbnailUrl: mine } },
    })
    expect(targets[0].options.thumbnailUrl).toBe(mine)
  })
})

/* ── the time a post is handed over with ────────────────────────────────── */

describe('the time a post is handed over with', () => {
  it('Post now sends NO time, so the provider publishes it straight away', async () => {
    const id = await readyPost()
    const r = await act(id, 'post_now', { confirm: true })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(jobs()).toHaveLength(1)
    expect(jobs()[0].scheduled_for).toBeFalsy()
  })

  it('…and Book in keeps the time of a post booked for a real date', async () => {
    const later = IN_THREE_DAYS()
    const id = await readyPost({ scheduled_for: later })
    await act(id, 'book')
    expect(jobs()).toHaveLength(1)
    expect(jobs()[0].scheduled_for).toBe(later)
  })
})

/* ── the rest of the calendar ───────────────────────────────────────────── */

describe('the calendar reads', () => {
  it('lists a client’s posts with their stage — never a status worked out from the item', async () => {
    const id = (await create()).body.post.id as string
    await act(id, 'send_to_qc')
    const res = await json(schedule.GET(new Request(`https://x.test/api/social/schedule?clientId=${CLIENT}`)))
    expect(res.status).toBe(200)
    expect(res.body.posts).toHaveLength(1)
    expect(res.body.posts[0]).toMatchObject({
      id, stage: 'quality_check', item_title: 'The launch post', source_deleted: false,
    })
    expect(res.body.posts[0].state).toMatchObject({ stage: 'quality_check', sent_version: 1 })
    expect(res.body.posts[0].block_reason).toBeNull()
  })

  it('keeps a post whose piece was deleted on the calendar, marked (audit S9)', async () => {
    const id = (await create()).body.post.id as string
    await table('content_items').remove(ITEM)
    const listed = await lib.listPosts({ clientId: CLIENT, viewer: AM as never })
    expect(listed.map(p => p.id)).toEqual([id])
    expect(listed[0].source_deleted).toBe(true)
  })

  it('keeps one client’s posts away from another', async () => {
    await create()
    const res = await json(schedule.GET(new Request('https://x.test/api/social/schedule?clientId=other')))
    expect(res.body.posts).toEqual([])
  })

  it('keeps a note on the calendar, and takes it away again', async () => {
    const at = IN_TWO_DAYS()
    const made = await json(notesRoute.POST(new Request('https://x.test/notes', {
      method: 'POST', body: JSON.stringify({ client_id: CLIENT, at, text: 'Studio booked' }),
    })))
    expect(made.status).toBe(200)
    const listed = await json(notesRoute.GET(new Request(`https://x.test/notes?clientId=${CLIENT}`)))
    expect(listed.body.notes).toHaveLength(1)

    const gone = await json(notesRoute.DELETE(
      new Request(`https://x.test/notes?id=${made.body.note.id}`, { method: 'DELETE' })))
    expect(gone.status).toBe(200)
    expect(fake.rows('schedule_notes')).toHaveLength(0)
  })

  it('lets only the writer or an account manager take a note away', async () => {
    as(AM)
    const hers = await json(notesRoute.POST(new Request('https://x.test/notes', {
      method: 'POST',
      body: JSON.stringify({ client_id: CLIENT, at: IN_TWO_DAYS(), text: 'Client away until the 19th' }),
    })))
    expect(hers.status).toBe(200)

    as(OWNER)
    const refused = await json(notesRoute.DELETE(
      new Request(`https://x.test/notes?id=${hers.body.note.id}`, { method: 'DELETE' })))
    expect(refused.status).toBe(403)
    expect(refused.body.error)
      .toBe('Only the person who wrote this note, or an account manager, can remove it')
    expect(fake.rows('schedule_notes')).toHaveLength(1)

    // …their own, they may
    const mine = await json(notesRoute.POST(new Request('https://x.test/notes', {
      method: 'POST',
      body: JSON.stringify({ client_id: CLIENT, at: IN_TWO_DAYS(), text: 'Reshoot the second slide' }),
    })))
    expect((await json(notesRoute.DELETE(
      new Request(`https://x.test/notes?id=${mine.body.note.id}`, { method: 'DELETE' })))).status).toBe(200)

    // …and an account manager may take anybody's
    as(AM)
    expect((await json(notesRoute.DELETE(
      new Request(`https://x.test/notes?id=${hers.body.note.id}`, { method: 'DELETE' })))).status).toBe(200)
    expect(fake.rows('schedule_notes')).toHaveLength(0)
  })

  it('lets the writer rewrite a note, and moves it with its words', async () => {
    const made = await json(notesRoute.POST(new Request('https://x.test/notes', {
      method: 'POST', body: JSON.stringify({ client_id: CLIENT, at: IN_TWO_DAYS(), text: 'Studio booked' }),
    })))
    const moved = IN_TWO_DAYS()
    const saved = await json(notesRoute.PATCH(new Request('https://x.test/notes', {
      method: 'PATCH',
      body: JSON.stringify({ id: made.body.note.id, text: 'Studio booked from 9', at: moved }),
    })))
    expect(saved.status).toBe(200)
    expect(saved.body.note.text).toBe('Studio booked from 9')
    expect(saved.body.note.at).toBe(new Date(moved).toISOString())
    // one row, rewritten — not a second note left beside the first
    expect(fake.rows('schedule_notes')).toHaveLength(1)
  })

  it('lets only the writer or an account manager rewrite a note', async () => {
    as(AM)
    const hers = await json(notesRoute.POST(new Request('https://x.test/notes', {
      method: 'POST',
      body: JSON.stringify({ client_id: CLIENT, at: IN_TWO_DAYS(), text: 'Client away' }),
    })))

    as(OWNER)
    const refused = await json(notesRoute.PATCH(new Request('https://x.test/notes', {
      method: 'PATCH', body: JSON.stringify({ id: hers.body.note.id, text: 'Client is around' }),
    })))
    expect(refused.status).toBe(403)
    expect(refused.body.error)
      .toBe('Only the person who wrote this note, or an account manager, can change it')
    expect((fake.rows('schedule_notes')[0] as Record<string, unknown>).text).toBe('Client away')
  })

  it('will not empty a note, or move one to a time it cannot read', async () => {
    const made = await json(notesRoute.POST(new Request('https://x.test/notes', {
      method: 'POST', body: JSON.stringify({ client_id: CLIENT, at: IN_TWO_DAYS(), text: 'Studio booked' }),
    })))
    const blank = await json(notesRoute.PATCH(new Request('https://x.test/notes', {
      method: 'PATCH', body: JSON.stringify({ id: made.body.note.id, text: '   ' }),
    })))
    expect(blank.status).toBe(400)
    expect(blank.body.error).toBe('Write the note first')

    const nonsense = await json(notesRoute.PATCH(new Request('https://x.test/notes', {
      method: 'PATCH', body: JSON.stringify({ id: made.body.note.id, at: 'sometime' }),
    })))
    expect(nonsense.status).toBe(400)
    expect((fake.rows('schedule_notes')[0] as Record<string, unknown>).text).toBe('Studio booked')
  })

  it('answers a time it cannot read with a bad request, not a conflict', async () => {
    const id = (await create()).body.post.id as string
    const moved = await moveTo(id, 'next tuesday-ish')
    expect(moved.status).toBe(400)
    expect(moved.body.error).toBe('That is not a time we can read — pick one from the calendar')
  })

  it('suggests times, and admits when they are the starting list', async () => {
    const res = await json(suggested.GET(
      new Request(`https://x.test/suggested?clientId=${CLIENT}&network=instagram`)))
    expect(res.status).toBe(200)
    expect(res.body.times.length).toBeGreaterThan(0)
    expect(res.body.times.every((t: { source: string }) => t.source === 'default')).toBe(true)
  })
})


/**
 * The per-network option lists.
 *
 * They are read-only and decorative next to publishing — but they are read
 * PER ACCOUNT, and an account belongs to a client. So the same scoping as
 * everything else on this page: a channel this person's clients do not own is
 * a channel that does not exist, answered the way the item page answers work
 * that is not theirs.
 */
describe('the lists behind the per-network options', () => {
  const options = (query: string) => json(channelOptions.GET(
    new Request(`https://x.test/api/social/schedule/options${query}`)))

  it('hands a scheduler the lists for a connected channel', async () => {
    as(SCHEDULER)
    const res = await options('?accountId=acc-1')
    expect(res.status).toBe(200)
    // the dry-run provider answers without a socket; the shape is what the
    // window draws its menus from
    expect(res.body).toMatchObject({
      playlists: [], organizations: [], pages: [], privacy: [],
    })
  })

  it('always offers TikTok somewhere to post, even when the creator list cannot be read', async () => {
    const tables = (fake.tree() as any).mdm.tables
    tables.social_accounts['acc-tt'] = {
      id: 'acc-tt', client_id: CLIENT, platform: 'tiktok', provider_account_id: 'prov-tt',
      name: 'Acme on TikTok', username: 'acme', avatar_url: null, active: true,
    }
    as(SCHEDULER)
    const res = await options('?accountId=acc-tt')
    expect(res.status).toBe(200)
    expect(res.body.privacy.map((p: { value: string }) => p.value))
      .toContain('PUBLIC_TO_EVERYONE')
  })

  it('asks which channel rather than guessing', async () => {
    as(SCHEDULER)
    expect((await options('')).status).toBe(400)
  })

  it('is a 404 for a channel that is gone, and for one that is not this person’s', async () => {
    as(SCHEDULER)
    expect((await options('?accountId=nope')).status).toBe(404)

    // an editor with no client of their own: the channel exists, and it is
    // not theirs to look at
    as({ id: 'u-ed3', role: 'editor', email: 'ed3@x.invalid', name: 'Ash', clerk_user_id: null })
    expect((await options('?accountId=acc-1')).status).toBe(404)
  })

  it('is closed to a client account', async () => {
    as({ id: 'u-cl', role: 'client', email: 'cl@x.invalid', name: 'Cass', clerk_user_id: null })
    expect((await options('?accountId=acc-1')).status).toBe(403)
  })
})

/* ── a second post of the same files names the first ────────────────────── */

describe('one open post per piece with the same files', () => {
  // the owner, 9 Sep 2026, testing with the same file twice: "why is this
  // coming up" — the refusal said "open that one" and named no way to.
  it('refuses the second press and says WHICH post to open', async () => {
    as(AM)
    const first = await create()
    expect(first.status).toBe(200)
    const again = await create()
    expect(again.status).toBe(409)
    expect(String(again.body.error)).toContain('open that one')
    expect(again.body.post_id).toBe(first.body.post.id)
    expect(again.body.item_id).toBe(ITEM)
  })
})


/* ── the note rule, on both sides of the wire ───────────────────────────── */

describe('the calendar draws the note buttons the server would honour', () => {
  /**
   * THE PARITY THAT MATTERS: `mayEditNote` is what the page asks before it
   * draws Change and Delete, and what the server asks before it does either.
   * If they were two copies of one rule, the drift would show up as a Delete
   * button that answers 403 — so this walks every role through BOTH and
   * insists they agree, note by note.
   */
  it('agrees with the route for every role, on their own note and somebody else’s', async () => {
    const { mayEditNote } = await import('@/app/lib/social-schedule-core')
    const cast = [AM, SCHEDULER, OWNER]

    // one note written by the account manager
    as(AM)
    const hers = (await json(notesRoute.POST(new Request('https://x.test/notes', {
      method: 'POST',
      body: JSON.stringify({ client_id: CLIENT, at: IN_TWO_DAYS(), text: 'Client away' }),
    })))).body.note

    for (const who of cast) {
      as(who)
      const allowedOnScreen = mayEditNote(who, hers)
      const answered = await json(notesRoute.PATCH(new Request('https://x.test/notes', {
        method: 'PATCH', body: JSON.stringify({ id: hers.id, text: `${who.name} was here` }),
      })))
      expect(answered.status === 200, `${who.role} on somebody else’s note`)
        .toBe(allowedOnScreen)

      // …and on a note of their own, which they always may
      const mine = (await json(notesRoute.POST(new Request('https://x.test/notes', {
        method: 'POST',
        body: JSON.stringify({ client_id: CLIENT, at: IN_TWO_DAYS(), text: 'Mine' }),
      })))).body.note
      expect(mayEditNote(who, mine), `${who.role} on their own note`).toBe(true)
      expect((await json(notesRoute.DELETE(
        new Request(`https://x.test/notes?id=${mine.id}`, { method: 'DELETE' })))).status).toBe(200)
    }
  })
})

/* ── the calendar is scoped by the ITEM, not only by the client ──────────── */

/**
 * THE API MUST NOT BE THE WIDER OF THE TWO SURFACES.
 *
 * The page has always refused to draw a post whose ITEM the viewer may not
 * see (`useSchedulePosts`'s `scopedItems`); the route filtered by `client_id`
 * alone. A scheduler is not bound by client — that is the ruling — but they
 * ARE bound by the job: a piece handed to a named scheduler belongs to that
 * person, and the board, the Scheduler page and the rail all hide it from
 * everybody else. Only the calendar's API did not, so the title and the
 * caption of somebody else's job were one request away.
 *
 * Same rule now, from the same helpers — `visibleItems` with
 * `scopeContextOf`, exactly as the items API and the page both call them.
 */
describe('listing a week', () => {
  /** a piece on this client handed to a DIFFERENT scheduler */
  const SOMEBODY_ELSES = 'a1b2c3d4-0000-4000-8000-0000000000ff'
  const OTHER_SCHEDULER = 'u-sch-2'

  const withSomebodyElsesJob = async () => {
    await table('content_items').insert({
      id: SOMEBODY_ELSES, client_id: CLIENT, title: 'Somebody else’s job',
      status: 'approved_for_scheduling', content_type: 'carousel',
      owner_id: OWNER.id, scheduler_ids: [OTHER_SCHEDULER], caption: 'Hello',
      posting_approval_state: null, platform_targets: ['instagram'],
    } as never)
    await table('asset_versions').insert({
      id: 'v2', item_id: SOMEBODY_ELSES, version_number: 1, files: SLIDES,
      file_url: SLIDES[0].url, dropbox_url: '', drive_url: '', notes: null,
      uploaded_by: OWNER.id,
    } as never)
    // the account manager, who may see everything on their client, starts it
    as(AM)
    const made = await json(schedule.POST(new Request('https://x.test/api/social/schedule', {
      method: 'POST',
      body: JSON.stringify({
        item_id: SOMEBODY_ELSES, slides: SLIDES, caption: 'Words nobody else should read',
        channels: ['acc-1'], scheduled_for: IN_TWO_DAYS(),
      }),
    })))
    expect(made.status).toBe(200)
    return made.body.post.id as string
  }

  it('hides a post whose job was handed to another scheduler', async () => {
    const hidden = await withSomebodyElsesJob()

    // the account manager on the client sees it
    const forAm = await lib.listPosts({ clientId: CLIENT, viewer: AM as never })
    expect(forAm.map(p => p.id)).toEqual([hidden])

    // the scheduler it was NOT handed to does not — not the tile, not the words
    const forScheduler = await lib.listPosts({ clientId: CLIENT, viewer: SCHEDULER as never })
    expect(forScheduler).toEqual([])
    expect(JSON.stringify(forScheduler)).not.toMatch(/nobody else should read/)
  })

  it('shows the scheduler the jobs that ARE theirs, and nobody else’s (9 Sep 2026)', async () => {
    await withSomebodyElsesJob()
    as(SCHEDULER)
    const mine = await create()            // ITEM was handed to this scheduler
    expect(mine.status).toBe(200)

    const listed = await lib.listPosts({ clientId: CLIENT, viewer: SCHEDULER as never })
    expect(listed.map(p => p.id)).toEqual([mine.body.post.id])
  })

  it('the route asks with the person who called it', async () => {
    await withSomebodyElsesJob()
    as(SCHEDULER)
    const answered = await json(schedule.GET(
      new Request(`https://x.test/api/social/schedule?clientId=${CLIENT}`)))
    expect(answered.status).toBe(200)
    expect(answered.body.posts).toEqual([])
  })

  it('with nobody asking, it is still the whole client — the internal callers', async () => {
    const hidden = await withSomebodyElsesJob()
    // `viewer` is optional so the two internal callers that have already
    // proved access need not invent one; every ROUTE passes it
    const all = await lib.listPosts({ clientId: CLIENT })
    expect(all.map(p => p.id)).toEqual([hidden])
  })
})

/* ── the switch the exception needs (I1) ──────────────────── */

/**
 * The column both server gates read was written by NOTHING: the owner's one
 * carve-out could only be armed by hand-editing the database, so a client
 * whose agreement said they see every post first was a client anybody could
 * post without.
 */
describe('the client\u2019s own "signs off every post" switch', () => {
  const read = () => json(clientApproval.GET(
    new Request('https://x.test/approval'), params(CLIENT)))
  const write = (body: unknown) => json(clientApproval.PUT(
    new Request('https://x.test/approval', { method: 'PUT', body: JSON.stringify(body) }),
    params(CLIENT),
  ))

  it('turns the exception ON, and the gates follow it in the same breath', async () => {
    fake.restore()
    fake = seed({ status: 'internal_review' })
    as(QA)
    expect((await read()).body.client_approval_required).toBe(false)

    const saved = await write({ on: true })
    expect(saved.status).toBe(200)
    expect(saved.body.client_approval_required).toBe(true)
    expect((fake.rows('clients')[0] as any).client_approval_required).toBe(true)

    // …and a manager STILL signs the work off themselves (the owner, 9 Sep
    // 2026): the switch is a reminder to them, not a gate on them
    const allowed = await json(transition.POST(
      new Request('https://x.test/transition', {
        method: 'POST', body: JSON.stringify({ to: 'approved_for_scheduling' }),
      }), params(ITEM)))
    expect(allowed.status).toBe(200)
    expect((fake.rows('content_items')[0] as any).status).toBe('approved_for_scheduling')
  })

  it('turns it off again', async () => {
    as(AM)
    await write({ on: true })
    const off = await write({ on: false })
    expect(off.body.client_approval_required).toBe(false)
  })

  it('a scheduler may READ the arrangement and may not decide it', async () => {
    as(SCHEDULER)
    expect((await read()).status).toBe(200)
    const refused = await write({ on: true })
    expect(refused.status).toBe(403)
    expect((fake.rows('clients')[0] as any).client_approval_required).toBeFalsy()
  })

  it('refuses somebody who is not on this client at all', async () => {
    as(STRANGER)
    expect((await write({ on: true })).status).toBe(403)
  })

  it('wants a yes or a no, not a guess', async () => {
    as(AM)
    const refused = await write({ on: 'yes' })
    expect(refused.status).toBe(400)
    expect(refused.body.error).toBe('Say whether it is on or off')
  })
})
