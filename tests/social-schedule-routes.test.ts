import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import { table } from '@/lib/db'
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
/**
 * The REAL workflow module, deliberately.
 *
 * A post an account manager sends straight out performs the media's own
 * sign-off on the way (`internal_review → approved_for_scheduling`), and a
 * stubbed `performTransition` would let that pass whatever it was given. The
 * edge, its role check, the client's policy and the activity line are the
 * point of the test, so the module runs for real over the fake database;
 * `mailer`, `production-live` and Drive are the mocks that keep it in the
 * room.
 */
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
const send = await import('../app/api/social/schedule/[id]/send/route')
const book = await import('../app/api/social/schedule/[id]/schedule/route')
const move = await import('../app/api/social/schedule/[id]/reschedule/route')
const notesRoute = await import('../app/api/social/schedule/notes/route')
const suggested = await import('../app/api/social/schedule/suggested/route')
const channelOptions = await import('../app/api/social/schedule/options/route')
const approval = await import('../app/api/production/items/[id]/posting-approval/route')
const adhoc = await import('../app/api/social/publish/route')
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

const as = (who: typeof AM) => { Object.assign(h.user, who) }

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

/** Make every READ of a path containing `needle` fail the way a dropped
 *  connection does. Returns the undo. */
function failReadsNaming(needle: string) {
  const inner = globalThis.fetch
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = typeof input === 'string' ? input : String(input?.url ?? '')
    if ((init?.method ?? 'GET').toUpperCase() === 'GET' && url.includes(needle)) {
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

  // THE CLICK THAT USED TO COST A CLIENT'S APPROVAL.
  //
  // The composer opened an approved post with an empty caption and empty
  // per-channel extras, and pressing Schedule PATCHed the WHOLE composition
  // — those empties included. `updatePost` read the empty caption as a
  // content change and took the sign-off back, from a press that changed
  // nothing anybody could see. The window now opens holding what the post
  // holds, so the body it sends back is identical; this is the route's half
  // of that promise.
  it('an untouched Schedule press sends the same body and keeps the approval', async () => {
    const id = (await create({
      per_channel: { 'acc-1': { firstComment: '#launch', locationId: '102938475610293' } },
    })).body.post.id as string
    await post(id)
    as(AM)
    await approve('approve')
    as(SCHEDULER)

    const before = row(id)
    // exactly what the composer sends when nobody has typed anything: every
    // field, read back off the post it opened with
    const unchanged = await json(one.PATCH(
      new Request('https://x.test/x', {
        method: 'PATCH',
        body: JSON.stringify({
          item_id: ITEM,
          slides: before.slides,
          caption: before.caption,
          channels: before.channels,
          per_channel: before.per_channel,
          scheduled_for: before.scheduled_for,
          timezone: 'Australia/Melbourne',
        }),
      }),
      params(id),
    ))

    expect(unchanged.status).toBe(200)
    expect(unchanged.body.post.status).toBe('approved')
    expect((fake.rows('content_items')[0] as any).posting_approval_state).toBe('approved')
    // …and nothing was quietly lost on the way through, either
    expect(row(id).caption).toBe('Hello everyone')
    expect(row(id).per_channel['acc-1'])
      .toEqual({ firstComment: '#launch', locationId: '102938475610293' })
  })

  it('an EMPTY caption on an approved post is still a change, and still costs the approval', async () => {
    // the other half: the guard must not have been loosened into "a caption
    // edit no longer counts". Somebody deliberately clearing the words is a
    // content change and has to be re-approved.
    const id = (await create()).body.post.id as string
    await post(id)
    as(AM)
    await approve('approve')
    as(SCHEDULER)
    const cleared = await json(one.PATCH(
      new Request('https://x.test/x', { method: 'PATCH', body: JSON.stringify({ caption: '' }) }),
      params(id),
    ))
    expect(cleared.status).toBe(200)
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

  /**
   * A PIECE THE CLIENT IS LOOKING AT RIGHT NOW IS NOT MEDIA TO POST WITH.
   *
   * For one day it was: `client_review` sat in the one-press set, so the
   * manager's rail offered it as ordinary usable media and one press took it
   * off the client's screen. Not even the account manager builds a post on it
   * now — the "Approve without client" button, and the question it asks, is
   * the only way past a review that is happening.
   */
  it('refuses a piece the client is looking at right now — for everybody', async () => {
    fake.restore()
    fake = seed({ status: 'client_review' })
    as(AM)
    const made = await create()
    expect(made.status).toBe(400)
    expect(made.body.error).toBe('With the client now')
    expect(fake.rows('social_posts')).toHaveLength(0)

    // …and a scheduler cannot see it at all, which is a different (older) refusal
    as(SCHEDULER)
    expect((await create()).status).toBe(404)
  })

  it('…and says the same on a client who signs every post off', async () => {
    fake.restore()
    fake = seed({ status: 'client_review' }, { client_approval_required: true })
    as(AM)
    const made = await create()
    expect(made.status).toBe(400)
    expect(made.body.error).toBe('With the client now')
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

/* ── one press, no approval step (ruled 5 Sep 2026) ───────────────── */

describe('an account manager posts media the client has not signed off', () => {
  /** the ordinary case: the work is finished and waiting on the manager's own
   *  check, and the item's own flag says the client normally sees it */
  const waiting = () => {
    fake.restore()
    fake = seed({ status: 'internal_review', client_approval_required: true })
  }

  it('does the media sign-off and the post approval in ONE request', async () => {
    waiting()
    as(AM)
    const made = await create()
    expect(made.status).toBe(200)
    const id = made.body.post.id as string

    const direct = await post(id, { mode: 'direct' })
    expect(direct.status).toBe(200)
    expect(direct.body.post.status).toBe('scheduled')
    expect(direct.body.post.approval_mode).toBe('self')
    expect(direct.body.post.approved_by).toBe(AM.id)

    // the MEDIA went the ordinary way: the item moved on the workflow edge…
    const item = fake.rows('content_items')[0] as any
    expect(item.status).toBe('approved_for_scheduling')
    // …and the post's own approval is the ordinary one on top of it
    expect(item.posting_approval_state).toBe('approved')
    expect(jobs()).toHaveLength(1)
  })

  it('…and records WHO signed the media off, on the ordinary activity trail', async () => {
    waiting()
    as(AM)
    const id = (await create()).body.post.id as string
    await post(id, { mode: 'direct' })

    const line = (fake.rows('workflow_activity') as any[]).find(
      a => a.entity_id === ITEM && a.new_value === 'approved_for_scheduling')
    expect(line).toBeTruthy()
    expect(line.actor_id).toBe(AM.id)
    expect(line.old_value).toBe('internal_review')
  })

  it('refuses a scheduler the same way approving would', async () => {
    waiting()
    // on a draft an account manager left behind — a scheduler cannot even see
    // a piece still in internal review, so this is the only way they reach one
    as(AM)
    const id = (await create()).body.post.id as string
    as(SCHEDULER)
    const direct = await post(id, { mode: 'direct' })
    // a piece still in internal review is not even theirs to look at, so the
    // refusal arrives one door earlier than the approval check — either way
    // nothing moved
    expect(direct.status).toBe(404)
    expect((fake.rows('content_items')[0] as any).status).toBe('internal_review')
    expect(jobs()).toHaveLength(0)

    // …and on a piece they CAN see, the refusal is the approval one, unchanged
    fake.restore()
    fake = seed()
    as(AM)
    const visible = (await create()).body.post.id as string
    as(SCHEDULER)
    const refused = await post(visible, { mode: 'direct' })
    expect(refused.status).toBe(403)
    expect(refused.body.error)
      .toBe('Only an account manager (or the client) can approve the final post')
  })

  it('refuses everybody on a client who signs every post off, in plain words', async () => {
    fake.restore()
    fake = seed({}, { client_approval_required: true })
    as(AM)
    const id = (await create()).body.post.id as string
    const direct = await post(id, { mode: 'direct' })
    expect(direct.status).toBe(403)
    expect(direct.body.error).toBe('This client signs off every post — send it for approval')
    expect(jobs()).toHaveLength(0)
    // nothing was written on the way to the refusal
    expect((fake.rows('content_items')[0] as any).posting_approval_state).toBeFalsy()
  })

  it('will not rescue a piece that is still being MADE — no edge takes it', async () => {
    fake.restore()
    fake = seed({ status: 'revision_required' })
    as(AM)
    const made = await create()
    expect(made.status).toBe(400)
    expect((fake.rows('content_items')[0] as any).status).toBe('revision_required')
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

/* ── cancelling takes the approval with it ──────────────────────────────── */

describe('cancelling a post', () => {
  const adhocFor = (body: Record<string, unknown> = {}) => json(
    adhoc.POST(new Request('https://x.test/api/social/publish', {
      method: 'POST',
      body: JSON.stringify({
        clientId: CLIENT, contentItemId: ITEM, caption: 'Straight to the queue',
        media: [{ url: SLIDES[0].url, type: 'image' }],
        targets: [{ platform: 'instagram', accountId: 'prov-1' }],
        ...body,
      }),
    })))

  it('puts the item\u2019s approval back, so nothing inherits it', async () => {
    const id = (await create()).body.post.id as string
    await post(id)
    as(AM)
    await approve('approve')
    as(SCHEDULER)
    expect((fake.rows('content_items')[0] as any).posting_approval_state).toBe('approved')

    const gone = await json(one.DELETE(new Request('https://x.test/x', { method: 'DELETE' }), params(id)))
    expect(gone.status).toBe(200)
    expect(gone.body.post.status).toBe('cancelled')
    // the yes belonged to that post, and that post is gone
    expect((fake.rows('content_items')[0] as any).posting_approval_state).toBe('draft')

    // …so the ad-hoc door is shut again for this item
    const adHoc = await adhocFor()
    expect(adHoc.status).toBe(409)
    expect(adHoc.body.error).toBe('Send the post for approval first')
    expect(jobs()).toHaveLength(0)
  })

  it('leaves the item alone when the post was never sent', async () => {
    fake.restore()
    fake = seed({ posting_approval_state: 'approved' })
    const id = (await create()).body.post.id as string

    const gone = await json(one.DELETE(new Request('https://x.test/x', { method: 'DELETE' }), params(id)))
    expect(gone.status).toBe(200)
    // nothing was ever asked on this post, so there is no answer to take back
    expect((fake.rows('content_items')[0] as any).posting_approval_state).toBe('approved')
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

/* ── the cover the editor saved ─────────────────────────────────────────── */

describe('the cover picture reaches the provider', () => {
  const COVER = 'https://media.mdmmarketing.com.au/one_cover.jpg'

  /** book a post in and hand back the targets that were queued */
  const bookAndRead = async (body: Record<string, unknown> = {}) => {
    const made = await create(body)
    const id = made.body.post.id as string
    await post(id)
    as(AM)
    await approve('approve')
    as(SCHEDULER)
    const booked = await bookIn(id)
    expect(booked.status).toBe(200)
    return (jobs()[0] as any).targets as any[]
  }

  it('sends the version’s cover as the post’s cover picture', async () => {
    // the editor writes it on the version, not on the post
    await (await import('@/lib/db')).table('asset_versions').update('v1', { cover_url: COVER })
    const targets = await bookAndRead()
    expect(targets).toHaveLength(1)
    expect(targets[0].options?.thumbnailUrl).toBe(COVER)
  })

  it('leaves the post alone when no cover was ever chosen', async () => {
    const targets = await bookAndRead()
    expect(targets[0]?.options?.thumbnailUrl).toBeUndefined()
  })

  it('never overrides a cover somebody typed in for that channel', async () => {
    await (await import('@/lib/db')).table('asset_versions').update('v1', { cover_url: COVER })
    const mine = 'https://media.mdmmarketing.com.au/typed_in.jpg'
    const targets = await bookAndRead({
      per_channel: { 'acc-1': { thumbnailUrl: mine } },
    })
    expect(targets[0].options.thumbnailUrl).toBe(mine)
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

  it('shows the scheduler the jobs that ARE theirs, and the unassigned ones', async () => {
    await withSomebodyElsesJob()
    as(SCHEDULER)
    const mine = await create()            // ITEM has no scheduler_ids at all
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


/* ── whose approval it actually was ─────────────────────── */

/**
 * THE HONESTY FIXES (reviewed 6 Sep 2026, all live at the time).
 *
 * Separate faults, one theme: the app said things about a client's sign-off
 * that were not true. Each test here fails without its fix.
 */
describe('an approval says who really gave it', () => {
  const approvalRows = () => fake.rows('approvals') as any[]

  const move = (to: string) => json(transition.POST(
    new Request('https://x.test/transition', {
      method: 'POST', body: JSON.stringify({ to }),
    }),
    params(ITEM),
  ))

  /**
   * C1a. `approval_type` used to be `from === 'client_review' ? 'client'` —
   * a fair inference while only a client could make that move, and a lie the
   * day a manager could too. It filed the manager's own decision under the
   * client's name, so a client asking "who approved this?" was told: you did.
   */
  it('files a manager\u2019s own sign-off as INTERNAL, never as the client\u2019s', async () => {
    fake.restore()
    fake = seed({ status: 'client_review' })
    as(AM)
    const done = await move('approved_for_scheduling')
    expect(done.status).toBe(200)
    const written = approvalRows().filter(a => a.item_id === ITEM)
    expect(written).toHaveLength(1)
    expect(written[0].approval_type).toBe('internal')
    expect(written[0].decided_by).toBe(AM.id)
  })

  it('\u2026and still files the client\u2019s own approval as the client\u2019s', async () => {
    fake.restore()
    fake = seed({ status: 'client_review' })
    as({ id: 'u-client', role: 'client', email: 'them@x.invalid', name: 'Bo', clerk_user_id: null, client_id: CLIENT } as never)
    const done = await move('approved_for_scheduling')
    expect(done.status).toBe(200)
    expect(approvalRows()[0].approval_type).toBe('client')
  })

  /**
   * M1. The workflow-level guard — the one that binds every surface, not just
   * the Schedule page — had no test at all, with the flag set or unset.
   */
  it('refuses the manager\u2019s own sign-off on a client who signs every post off', async () => {
    fake.restore()
    fake = seed({ status: 'internal_review' }, { client_approval_required: true })
    as(AM)
    const refused = await move('approved_for_scheduling')
    expect(refused.status).toBe(403)
    expect(refused.body.error)
      .toBe('This client signs their work off themselves \u2014 send it to them first')
    expect((fake.rows('content_items')[0] as any).status).toBe('internal_review')
    expect(approvalRows()).toHaveLength(0)
  })

  it('\u2026and allows it on an ordinary client, with the flag unset', async () => {
    fake.restore()
    fake = seed({ status: 'internal_review' })
    as(AM)
    const done = await move('approved_for_scheduling')
    expect(done.status).toBe(200)
    expect((fake.rows('content_items')[0] as any).status).toBe('approved_for_scheduling')
    expect(approvalRows()[0].approval_type).toBe('internal')
  })

  /**
   * I2. The policy read ended in `.catch(() => null)`, so a dropped connection
   * answered "the ordinary arrangement" — i.e. go ahead — to the one question
   * protecting the one client who insisted on seeing every post.
   */
  it('REFUSES rather than assumes when the client row cannot be read', async () => {
    fake.restore()
    fake = seed({ status: 'internal_review' })
    as(AM)
    const undo = failReadsNaming('/clients/')
    try {
      const refused = await move('approved_for_scheduling')
      expect(refused.status).toBe(503)
      expect(refused.body.error).toContain('could not check')
      expect((fake.rows('content_items')[0] as any).status).toBe('internal_review')
    } finally {
      undo()
    }
  })

  it('\u2026and the Schedule page\u2019s own path refuses too', async () => {
    fake.restore()
    fake = seed({ status: 'approved_for_scheduling' })
    as(AM)
    const id = (await create()).body.post.id as string
    const undo = failReadsNaming('/clients/')
    try {
      const refused = await post(id, { mode: 'direct' })
      expect(refused.status).toBe(503)
      expect(refused.body.error).toContain('could not check')
      expect(jobs()).toHaveLength(0)
    } finally {
      undo()
    }
  })

  /**
   * I3. `performTransition` used to run BEFORE the composition was checked, so
   * a caption one letter too long left the media signed off in the manager's
   * name and the team emailed, with no post — and the person, looking at an
   * error, believed nothing had happened.
   */
  it('a post that cannot be composed leaves the media UNSIGNED and nobody emailed', async () => {
    fake.restore()
    fake = seed({ status: 'internal_review' })
    as(AM)
    const id = (await create()).body.post.id as string
    // the channel goes away between the window opening and the press — the
    // ordinary shape of this failure, and the one the reviewer described
    await table('social_accounts').remove('acc-1')

    const refused = await post(id, { mode: 'direct' })
    expect(refused.status).toBe(400)
    // the item never moved, so there is no approval, no activity line and no
    // fan-out to undo
    const item = fake.rows('content_items')[0] as any
    expect(item.status).toBe('internal_review')
    expect(item.posting_approval_state).toBeFalsy()
    expect(approvalRows()).toHaveLength(0)
    expect((fake.rows('workflow_activity') as any[]).filter(
      a => a.entity_id === ITEM && a.new_value === 'approved_for_scheduling')).toHaveLength(0)
    expect(jobs()).toHaveLength(0)
  })
})

/* ── "Post now" posts now ────────────────────────────── */

describe('the time a post is handed over with', () => {
  /**
   * I4. The button says "Post now"; the job carried a `scheduledFor` that had
   * usually gone by the time the provider saw it. `buildPostBody` sends
   * `publishNow: true` for a job with no time on it, so the honest thing is to
   * send no time.
   */
  it('sends NO time for a post whose time is now, so the provider publishes it', async () => {
    as(AM)
    const soon = new Date(Date.now() + 60_000).toISOString()
    const id = (await create({ scheduled_for: soon })).body.post.id as string
    const sent = await post(id, { mode: 'direct' })
    expect(sent.status).toBe(200)
    expect(jobs()).toHaveLength(1)
    // the row carries no time at all, so `buildPostBody` sends publishNow
    expect(jobs()[0].scheduled_for).toBeFalsy()
  })

  it('\u2026and keeps the time on a post booked for a real date', async () => {
    as(AM)
    const later = IN_THREE_DAYS()
    const id = (await create({ scheduled_for: later })).body.post.id as string
    await post(id, { mode: 'direct' })
    expect(jobs()).toHaveLength(1)
    expect(jobs()[0].scheduled_for).toBe(later)
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
    as(AM)
    expect((await read()).body.client_approval_required).toBe(false)

    const saved = await write({ on: true })
    expect(saved.status).toBe(200)
    expect(saved.body.client_approval_required).toBe(true)
    expect((fake.rows('clients')[0] as any).client_approval_required).toBe(true)

    // …and now nobody takes the short cut on this client
    const refused = await json(transition.POST(
      new Request('https://x.test/transition', {
        method: 'POST', body: JSON.stringify({ to: 'approved_for_scheduling' }),
      }), params(ITEM)))
    expect(refused.status).toBe(403)
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
