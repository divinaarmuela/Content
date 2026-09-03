import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'

/**
 * The whole server flow of a planned post, on the real `@/lib/db` over an
 * in-memory Realtime Database: create → send → approve THROUGH THE EXISTING
 * item route → schedule → reschedule → cancel, plus the two rules that cannot
 * be allowed to rot — the approval lock on every publish path, and "one set
 * of jobs, however many people click".
 *
 * Nothing here may reach a real account: PUBLISH_DRY_RUN=1 makes the provider
 * itself answer with a fake id, and the only fetch in the process is the fake
 * database.
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
vi.mock('../app/lib/workflow', () => ({
  logActivity: vi.fn(), sanitiseRawAssets: (v: unknown) => (Array.isArray(v) ? v : []),
}))
vi.mock('../app/lib/production-live', () => ({
  announceItemChange: vi.fn(), announceBatchChange: vi.fn(),
}))
vi.mock('../lib/live', () => ({ announce: vi.fn(), announceAfter: vi.fn() }))
vi.mock('../app/inngest/client', () => ({ inngest: { send: vi.fn(async () => ({})) } }))

const schedule = await import('../app/api/social/schedule/route')
const one = await import('../app/api/social/schedule/[id]/route')
const send = await import('../app/api/social/schedule/[id]/send/route')
const book = await import('../app/api/social/schedule/[id]/schedule/route')
const move = await import('../app/api/social/schedule/[id]/reschedule/route')
const notesRoute = await import('../app/api/social/schedule/notes/route')
const suggested = await import('../app/api/social/schedule/suggested/route')
const approval = await import('../app/api/production/items/[id]/posting-approval/route')
const adhoc = await import('../app/api/social/publish/route')
const lib = await import('../app/lib/social-schedule')

/* ── the cast ───────────────────────────────────────────────────────────── */

const CLIENT = 'c1'
const ITEM = 'a1b2c3d4-0000-4000-8000-000000000001'
const AM = { id: 'u-am', role: 'account_manager', email: 'am@x.invalid', name: 'Ada', clerk_user_id: null }
const SCHEDULER = { id: 'u-sch', role: 'scheduler', email: 'sch@x.invalid', name: 'Sam', clerk_user_id: null }
const OWNER = { id: 'u-ed', role: 'editor', email: 'ed@x.invalid', name: 'Eden', clerk_user_id: null }
const STRANGER = { id: 'u-ed2', role: 'editor', email: 'ed2@x.invalid', name: 'Kit', clerk_user_id: null }

const as = (who: typeof AM) => { Object.assign(h.user, who) }

const SLIDES = [
  { url: 'https://media.mdmmarketing.com.au/one.jpg', name: 'one.jpg', type: 'image' },
  { url: 'https://media.mdmmarketing.com.au/two.jpg', name: 'two.jpg', type: 'image' },
]

const IN_TWO_DAYS = () => new Date(Date.now() + 2 * 86_400_000).toISOString()
const IN_THREE_DAYS = () => new Date(Date.now() + 3 * 86_400_000).toISOString()

let fake: ReturnType<typeof seedDb>

function seed(itemPatch: Record<string, unknown> = {}) {
  return seedDb({
    clients: [{ id: CLIENT, name: 'Acme', timezone: 'Australia/Melbourne' }] as unknown as Row[],
    content_items: [{
      id: ITEM, client_id: CLIENT, title: 'The launch post', status: 'approved_for_scheduling',
      content_type: 'carousel', owner_id: OWNER.id, scheduler_ids: [], caption: 'Hello',
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

const post = (id: string, body: Record<string, unknown> = {}) => json(
  send.POST(new Request('https://x.test/send', {
    method: 'POST', body: JSON.stringify(body),
  }), params(id)))
const bookIn = (id: string) => json(
  book.POST(new Request('https://x.test/schedule', { method: 'POST' }), params(id)))
const moveTo = (id: string, at: string) => json(
  move.POST(new Request('https://x.test/reschedule', { method: 'POST', body: JSON.stringify({ at }) }), params(id)))
const approve = (action: 'approve' | 'request_changes', note = 'Looks good') => json(
  approval.POST(
    new Request('https://x.test/posting-approval', { method: 'POST', body: JSON.stringify({ action, note }) }),
    params(ITEM),
  ))

/** Make every write whose payload contains `needle` fail the way a dropped
 *  connection does. Returns the undo. */
function failWritesNaming(needle: string) {
  const inner = globalThis.fetch
  globalThis.fetch = (async (input: any, init: any = {}) => {
    if ((init?.method ?? 'GET').toUpperCase() !== 'GET'
      && typeof init?.body === 'string' && init.body.includes(needle)) {
      throw new TypeError('fetch failed')
    }
    return inner(input, init)
  }) as typeof globalThis.fetch
  return () => { globalThis.fetch = inner }
}

const row = (id: string) => fake.rows('social_posts').find(p => p.id === id) as any
const jobs = () => fake.rows('publish_jobs') as any[]

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
  it('create → send → approve on the item route → schedule → reschedule → cancel', async () => {
    // create
    const made = await create()
    expect(made.status).toBe(200)
    expect(made.body.post.status).toBe('draft')
    expect(made.body.post.slides).toHaveLength(2)
    const id = made.body.post.id as string

    // send for approval — the ITEM is what moves
    const sent = await post(id)
    expect(sent.status).toBe(200)
    expect(sent.body.post.status).toBe('pending')
    expect(sent.body.post.sent_at).toBeTruthy()
    expect((fake.rows('content_items')[0] as any).posting_approval_state).toBe('pending')

    // a post waiting on approval cannot be booked
    expect((await bookIn(id)).status).toBe(409)
    expect(jobs()).toHaveLength(0)

    // approve through the EXISTING item route, as the account manager
    as(AM)
    const answered = await approve('approve')
    expect(answered.status).toBe(200)
    expect(answered.body.posting_approval_state).toBe('approved')
    // …and the calendar tile followed it without anybody touching the post
    expect(row(id).status).toBe('approved')

    // book it in — the provider is stubbed by PUBLISH_DRY_RUN
    as(SCHEDULER)
    const booked = await bookIn(id)
    expect(booked.status).toBe(200)
    expect(booked.body.post.status).toBe('scheduled')
    expect(jobs()).toHaveLength(1)
    expect(jobs()[0].content_item_id).toBe(ITEM)
    expect(jobs()[0].targets[0]).toMatchObject({ platform: 'instagram', accountId: 'prov-1' })
    expect(booked.body.post.publish_job_ids).toEqual([jobs()[0].id])

    // move it: the provider is holding this one, so the old job is pulled back
    const later = IN_THREE_DAYS()
    const moved = await moveTo(id, later)
    expect(moved.status).toBe(200)
    expect(moved.body.mode).toBe('requeue')
    expect(moved.body.post.scheduled_for).toBe(later)
    expect(jobs().filter(j => j.status === 'cancelled')).toHaveLength(1)
    expect(jobs().filter(j => j.status === 'queued')).toHaveLength(1)

    // and take it off the calendar
    const gone = await json(one.DELETE(new Request('https://x.test/x', { method: 'DELETE' }), params(id)))
    expect(gone.status).toBe(200)
    expect(gone.body.post.status).toBe('cancelled')
    expect(jobs().every(j => j.status === 'cancelled')).toBe(true)
  })

  it('moves a post nobody has handed over yet with one write', async () => {
    const id = (await create()).body.post.id as string
    const later = IN_THREE_DAYS()
    const moved = await moveTo(id, later)
    expect(moved.status).toBe(200)
    expect(moved.body.mode).toBe('move')
    expect(row(id).scheduled_for).toBe(later)
    expect(jobs()).toHaveLength(0)
  })

  it('refuses a time that has already gone, in plain words', async () => {
    const id = (await create()).body.post.id as string
    const moved = await moveTo(id, new Date(Date.now() - 3600_000).toISOString())
    expect(moved.status).toBe(409)
    expect(moved.body.error).toBe('That time has already gone — pick a later one')
  })

  it('takes the approval back when the words change, and says so on the item', async () => {
    const id = (await create()).body.post.id as string
    await post(id)
    as(AM)
    await approve('approve')
    as(SCHEDULER)

    const edited = await json(one.PATCH(
      new Request('https://x.test/x', { method: 'PATCH', body: JSON.stringify({ caption: 'A different line' }) }),
      params(id),
    ))
    expect(edited.status).toBe(200)
    expect(edited.body.post.status).toBe('pending')
    expect((fake.rows('content_items')[0] as any).posting_approval_state).toBe('pending')
  })

  it('keeps the approval when only the time moves', async () => {
    const id = (await create()).body.post.id as string
    await post(id)
    as(AM)
    await approve('approve')
    as(SCHEDULER)
    await moveTo(id, IN_THREE_DAYS())
    expect((fake.rows('content_items')[0] as any).posting_approval_state).toBe('approved')
    expect(row(id).status).toBe('approved')
  })

  it('mirrors "changes requested" onto the tile', async () => {
    const id = (await create()).body.post.id as string
    await post(id)
    as(AM)
    expect((await approve('request_changes', 'Shorten the caption')).status).toBe(200)
    expect(row(id).status).toBe('changes')
  })

  it('refuses graphics that are not part of the approved version', async () => {
    const bad = await create({
      slides: [{ url: 'https://elsewhere.invalid/sneaky.jpg', name: 'sneaky.jpg', type: 'image' }],
    })
    expect(bad.status).toBe(400)
    expect(bad.body.error).toContain('approved version')
    expect(fake.rows('social_posts')).toHaveLength(0)
  })

  it('refuses an item the client has not signed off, in that person’s own words', async () => {
    fake.restore()
    fake = seed({ status: 'client_review' })
    // the account manager can SEE an item still with the client; a scheduler
    // cannot see it at all, which is a different (older) refusal
    as(AM)
    const made = await create()
    expect(made.status).toBe(400)
    expect(made.body.error).toBe('Still with the client')

    as(SCHEDULER)
    expect((await create()).status).toBe(404)
    expect(fake.rows('social_posts')).toHaveLength(0)
  })
})

/* ── scheduling without asking ──────────────────────────────────────────── */

describe('schedule without approval', () => {
  it('lets an account manager clear their own post and book it in', async () => {
    const made = await create()
    const id = made.body.post.id as string

    as(AM)
    const direct = await post(id, { mode: 'direct' })
    expect(direct.status).toBe(200)
    expect(direct.body.post.status).toBe('scheduled')
    expect(direct.body.post.approval_mode).toBe('self')
    expect(direct.body.post.approved_by).toBe(AM.id)
    // the item went through the ordinary state machine, so every other screen
    // reads it as an approved post
    expect((fake.rows('content_items')[0] as any).posting_approval_state).toBe('approved')
    expect(jobs()).toHaveLength(1)
  })

  it('refuses a scheduler, in the same words approving would', async () => {
    const id = (await create()).body.post.id as string
    as(SCHEDULER)
    const direct = await post(id, { mode: 'direct' })
    expect(direct.status).toBe(403)
    expect(direct.body.error).toBe('Only an account manager (or the client) can approve the final post')
    expect(jobs()).toHaveLength(0)
    expect((fake.rows('content_items')[0] as any).posting_approval_state).toBeFalsy()
  })

  it('refuses an editor on their own item too', async () => {
    as(OWNER)
    const id = (await create()).body.post.id as string
    const direct = await post(id, { mode: 'direct' })
    expect(direct.status).toBe(403)
    expect(jobs()).toHaveLength(0)
  })

  it('marks an ordinary send as the client route', async () => {
    const id = (await create()).body.post.id as string
    await post(id)
    expect(row(id).approval_mode).toBe('client')
  })
})

/* ── exactly one winner ─────────────────────────────────────────────────── */

describe('two people booking the same post', () => {
  it('queues one set of jobs, and the loser is told plainly', async () => {
    const id = (await create()).body.post.id as string
    await post(id)
    as(AM)
    await approve('approve')
    as(SCHEDULER)

    const [a, b] = await Promise.all([bookIn(id), bookIn(id)])
    const wins = [a, b].filter(r => r.status === 200)
    expect(wins).toHaveLength(1)
    expect(jobs()).toHaveLength(1)
    const loser = [a, b].find(r => r.status !== 200)!
    expect(loser.status).toBe(409)
    expect(String(loser.body.error)).toMatch(/already/i)
  })

  it('starts one post per item, however many times the button is pressed', async () => {
    const [a, b] = await Promise.all([create(), create()])
    expect([a, b].filter(r => r.status === 200)).toHaveLength(1)
    expect(fake.rows('social_posts')).toHaveLength(1)
  })
})

/* ── the lock, on every path ────────────────────────────────────────────── */

describe('the approval lock', () => {
  const adhocBody = {
    clientId: CLIENT,
    contentItemId: ITEM,
    caption: 'Straight to the queue',
    media: [{ url: 'https://media.mdmmarketing.com.au/one.jpg', type: 'image' }],
    targets: [{ platform: 'instagram', accountId: 'prov-1' }],
  }
  const adhocPost = (body: Record<string, unknown> = {}) => json(
    adhoc.POST(new Request('https://x.test/api/social/publish', {
      method: 'POST', body: JSON.stringify({ ...adhocBody, ...body }),
    })))

  it('refuses an ad-hoc publish while the item is waiting on approval', async () => {
    fake.restore()
    fake = seed({ posting_approval_state: 'pending' })
    const res = await adhocPost()
    expect(res.status).toBe(409)
    expect(res.body.error).toBe(
      'Waiting on final approval — the post was sent for sign-off and nobody has approved it yet',
    )
    expect(jobs()).toHaveLength(0)
  })

  it('refuses one where changes were asked for', async () => {
    fake.restore()
    fake = seed({ posting_approval_state: 'changes' })
    const res = await adhocPost()
    expect(res.status).toBe(409)
    expect(res.body.error).toContain('Changes were asked for')
    expect(jobs()).toHaveLength(0)
  })

  it('lets an approved item through', async () => {
    fake.restore()
    fake = seed({ posting_approval_state: 'approved' })
    const res = await adhocPost()
    expect(res.status).toBe(200)
    expect(jobs()).toHaveLength(1)
  })

  it('refuses an editor the ad-hoc publish door, approved item or not', async () => {
    fake.restore()
    fake = seed({ posting_approval_state: 'approved' })
    as(OWNER)
    const res = await adhocPost()
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('Posting to a channel is for schedulers and account managers')
    expect(jobs()).toHaveLength(0)

    // …and with nothing linked, where the approval gate has nothing to say
    const loose = await adhocPost({ contentItemId: null })
    expect(loose.status).toBe(403)
    expect(jobs()).toHaveLength(0)
  })

  it('refuses an editor the list of what went out', async () => {
    as(OWNER)
    const res = await json(adhoc.GET(new Request('https://x.test/api/social/publish')))
    expect(res.status).toBe(403)
  })

  it('leaves a post with no item linked exactly as it was', async () => {
    fake.restore()
    fake = seed({ posting_approval_state: 'pending' })
    const res = await adhocPost({ contentItemId: null })
    expect(res.status).toBe(200)
    expect(jobs()).toHaveLength(1)
  })
})

/* ── a post reads its OWN jobs ──────────────────────────────────────────── */

describe('one item, one post at a time', () => {
  it('leaves a fresh post alone after the previous one was cancelled', async () => {
    // A: made, approved, booked in, then taken off the calendar
    const a = (await create()).body.post.id as string
    await post(a)
    as(AM)
    await approve('approve')
    as(SCHEDULER)
    await bookIn(a)
    await json(one.DELETE(new Request('https://x.test/x', { method: 'DELETE' }), params(a)))
    expect(row(a).status).toBe('cancelled')
    expect(jobs().every(j => j.status === 'cancelled')).toBe(true)

    // B: a new post on the same item — cancelling A freed the item
    const made = await create()
    expect(made.status).toBe(200)
    const b = made.body.post.id as string
    expect(made.body.post.status).toBe('draft')

    // the mirror must read B's own jobs (it has none), not A's cancelled one
    await lib.syncFromItem(ITEM)
    expect(row(b).status).toBe('draft')
    expect(row(a).status).toBe('cancelled')

    const listed = await json(schedule.GET(
      new Request(`https://x.test/api/social/schedule?clientId=${CLIENT}`)))
    const tile = listed.body.posts.find((x: { id: string }) => x.id === b)
    expect(tile.live_status).toBe('draft')
  })

  it('reads an approved post as approved when the requeue could not be made', async () => {
    const id = (await create()).body.post.id as string
    await post(id)
    as(AM)
    await approve('approve')
    as(SCHEDULER)
    await bookIn(id)
    expect(jobs()).toHaveLength(1)

    // the channel takes the cancel but the new booking will not go in
    const off = failWritesNaming('"status":"queued"')
    const moved = await moveTo(id, IN_THREE_DAYS())
    off()

    expect(moved.status).toBe(409)
    expect(row(id).status).toBe('approved')
    expect(row(id).publish_job_ids ?? []).toEqual([])
    const listed = await json(schedule.GET(
      new Request(`https://x.test/api/social/schedule?clientId=${CLIENT}`)))
    expect(listed.body.posts[0].live_status).toBe('approved')
  })
})

/* ── sending, when somebody got there first ─────────────────────────────── */

describe('send for approval, against a moving post', () => {
  it('will not drag a post that was booked in the meantime back to pending', async () => {
    const id = (await create()).body.post.id as string
    await post(id)
    as(AM)
    await approve('request_changes', 'Shorten the caption')
    as(SCHEDULER)
    expect(row(id).status).toBe('changes')

    // the rival's write lands between this send's read and its own write
    const off = fake.onBeforeWrite(`/mdm/tables/social_posts/${id}`, () => {
      off()
      const live = (fake.tree() as any).mdm.tables.social_posts[id]
      live.status = 'scheduled'
    })
    const sent = await post(id)

    expect(sent.status).toBe(409)
    expect(sent.body.error).toContain('moved on while you were sending it')
    expect(row(id).status).toBe('scheduled')
  })

  it('treats a second click on an already-pending post as done, not as an error', async () => {
    const id = (await create()).body.post.id as string
    expect((await post(id)).status).toBe(200)
    const again = await post(id)
    expect(again.status).toBe(200)
    expect(again.body.post.status).toBe('pending')
  })
})

/* ── who may do what ────────────────────────────────────────────────────── */

describe('roles', () => {
  it('lets an editor draft a post on their OWN item', async () => {
    as(OWNER)
    const made = await create()
    expect(made.status).toBe(200)
    expect(made.body.post.created_by).toBe(OWNER.id)
  })

  it('refuses an editor on somebody else’s item', async () => {
    as(STRANGER)
    const made = await create()
    expect(made.status).toBe(403)
    expect(fake.rows('social_posts')).toHaveLength(0)
  })

  it('refuses an editor the booking, even on their own post', async () => {
    as(OWNER)
    const id = (await create()).body.post.id as string
    await post(id)
    as(AM)
    await approve('approve')
    as(OWNER)
    const booked = await bookIn(id)
    expect(booked.status).toBe(403)
    expect(booked.body.error).toBe('Only a scheduler or an account manager can book a post to go out')
    expect(jobs()).toHaveLength(0)
  })

  it('refuses a client outright', async () => {
    as({ ...OWNER, role: 'client' } as typeof AM)
    expect((await create()).status).toBe(403)
  })
})

/* ── the rest of the calendar ───────────────────────────────────────────── */

describe('the calendar reads', () => {
  it('lists a client’s posts with the status the tile should wear', async () => {
    const id = (await create()).body.post.id as string
    await post(id)
    const res = await json(schedule.GET(new Request(`https://x.test/api/social/schedule?clientId=${CLIENT}`)))
    expect(res.status).toBe(200)
    expect(res.body.posts).toHaveLength(1)
    expect(res.body.posts[0]).toMatchObject({
      id, live_status: 'pending', item_title: 'The launch post',
    })
    expect(res.body.posts[0].block_reason).toContain('Waiting on final approval')
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
