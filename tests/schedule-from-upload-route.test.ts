import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isAdHocUploadVersion } from '../app/lib/schedule-upload-core'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'

/**
 * A FILE BECOMES A POST, WITH NO PIECE IN THE DATABASE TO START FROM.
 *
 * The whole server flow of the owner's request — "there should be no approval
 * they should simply be here upload media, upload drive files any media" —
 * over the real `@/lib/db` on an in-memory Realtime Database:
 *
 *   anybody uploads → the piece is made as the holder of the files, left at
 *   draft, and the post is a DRAFT (the owner's decision 7) → the post is
 *   composed, sent for quality check, passed and booked in (dry run);
 *
 *   a scheduler cannot pass their own post: it waits for the quality check;
 *
 *   a client who signs off every post changes nothing for a manager (the
 *   owner, 9 Sep 2026) — the switch is a note, not a gate.
 *
 * Nothing here may reach a real account (PUBLISH_DRY_RUN=1) or a real bucket:
 * storage is mocked, so the only fetch in the process is the fake database.
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
// the piece is created for real; the folder it would get is Drive's business
// and Drive is not in this room
vi.mock('../app/lib/gdrive-hooks', () => ({ onItemsCreated: vi.fn() }))
vi.mock('../app/lib/stream', () => ({ previewVideos: vi.fn() }))
vi.mock('../app/lib/production-live', () => ({
  announceItemChange: vi.fn(), announceBatchChange: vi.fn(),
}))
vi.mock('../lib/live', () => ({ announce: vi.fn(), announceAfter: vi.fn() }))
vi.mock('../app/inngest/client', () => ({ inngest: { send: vi.fn(async () => ({})) } }))

/** The bucket, answered from memory: the guard that matters is that a URL is
 *  ON our own storage and shaped like a key we minted, and that is pure. */
const BASE = 'https://media.mdmmarketing.com.au'
vi.mock('../app/lib/storage', () => ({
  publicBase: () => BASE,
  headStoredObject: vi.fn(async (url: string) => ({
    contentType: url.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg',
    bytes: 900_000,
  })),
  deleteStoredObject: vi.fn(async () => {}),
  MAX_DERIVED_BYTES: 64 * 1024 * 1024,
}))

const fromUpload = await import('../app/api/social/schedule/from-upload/route')
const one = await import('../app/api/social/schedule/[id]/route')
// every move of a post goes through the one route (the posting rebuild, 29 Sep 2026)
const actRoute = await import('../app/api/posts/[id]/act/route')

/* ── the cast ───────────────────────────────────────────────────────────── */

const CLIENT = 'c1'
const AM = { id: 'u-am', role: 'account_manager', email: 'am@x.invalid', name: 'Ada', clerk_user_id: null }
const SCHEDULER = { id: 'u-sch', role: 'scheduler', email: 'sch@x.invalid', name: 'Sam', clerk_user_id: null }

/** the quality reviewer's hat is a flag, so it has to be put DOWN between people */
const as = (who: typeof AM & { quality_reviewer?: boolean }) => { Object.assign(h.user, { quality_reviewer: false }, who) }
/** Ada again, flagged as the quality reviewer (Joy's hat on a manager) */
const QA = { ...AM, quality_reviewer: true }

const FILE = {
  url: `${BASE}/1712345678901-ab12cd-spring_launch.jpg`,
  name: 'spring_launch.jpg',
  type: 'image',
  bytes: 900_000,
  source: 'upload',
}

const IN_TWO_DAYS = () => new Date(Date.now() + 2 * 86_400_000).toISOString()

let fake: ReturnType<typeof seedDb>

function seed(clientPatch: Record<string, unknown> = {}) {
  return seedDb({
    clients: [{
      id: CLIENT, name: 'Acme', timezone: 'Australia/Melbourne', ...clientPatch,
    }] as unknown as Row[],
    // NOTHING in production: this is the state the owner's workspace was in
    content_items: [],
    asset_versions: [],
    work_kinds: [{
      id: 'k-edit', slug: 'edit', name: 'Edit', default_roles: ['editor'],
      uses_media: true, color: 'zinc', active: true, sort_order: 1,
    }] as unknown as Row[],
    social_accounts: [{
      id: 'acc-1', client_id: CLIENT, platform: 'instagram', provider_account_id: 'prov-1',
      name: 'Acme on Instagram', username: 'acme', avatar_url: null, active: true,
    }] as unknown as Row[],
    team_users: [AM, SCHEDULER].map(u => ({
      ...u, active_status: true, employment_type: 'employee',
      timezone: 'Australia/Melbourne', client_id: null,
    })) as unknown as Row[],
    team_user_clients: [AM, SCHEDULER].map(u => ({
      id: `${u.id}__${CLIENT}`, team_user_id: u.id, client_id: CLIENT,
    })) as unknown as Row[],
    social_posts: [],
    publish_jobs: [],
    claim_locks: [],
    workflow_activity: [],
  })
}

const json = async (res: Response | Promise<Response>) => {
  const r = await res
  return { status: r.status, body: await r.json() as any }
}

const upload = (body: Record<string, unknown> = {}) => json(
  fromUpload.POST(new Request('https://x.test/api/social/schedule/from-upload', {
    method: 'POST',
    body: JSON.stringify({
      client_id: CLIENT, files: [FILE], scheduled_for: IN_TWO_DAYS(), ...body,
    }),
  })))

const params = (id: string) => ({ params: Promise.resolve({ id }) })

const compose = (id: string, body: Record<string, unknown>) => json(
  one.PATCH(new Request('https://x.test/post', {
    method: 'PATCH', body: JSON.stringify(body),
  }), params(id)))

/** one move on the post, with the rev (and version) the page would have drawn */
const act = async (id: string, action: string, extra: Record<string, unknown> = {}) => {
  const row = fake.rows('social_posts').find(p => p.id === id) as any
  return json(actRoute.POST(new Request('https://x.test/act', {
    method: 'POST',
    body: JSON.stringify({ action, expect_rev: row?.rev ?? 0, version: row?.sent_version ?? undefined, ...extra }),
  }), params(id)))
}

const items = () => fake.rows('content_items') as any[]
const versions = () => fake.rows('asset_versions') as any[]
const jobs = () => fake.rows('publish_jobs') as any[]

let undoAutoBook: () => void = () => {}
beforeEach(async () => {
  process.env.PUBLISH_DRY_RUN = '1'
  process.env.ZERNIO_API_KEY = 'not-used-in-a-dry-run'
  as(AM)
  fake = seed()
  // these walk-throughs press Book in themselves; auto-booking is tested in tests/post-stage.test.ts
  undoAutoBook = (await import('@/app/lib/post-stage')).usePostEngineDeps({ autoBook: false })
})
afterEach(() => {
  undoAutoBook()
  fake.restore()
  delete process.env.PUBLISH_DRY_RUN
  vi.clearAllMocks()
})

/* ── the account manager ────────────────────────────────────────────────── */

describe('an account manager posts a file with no piece behind it', () => {
  // THE UPLOAD IS A POST (the owner's decision 7; review fix, 29 Sep 2026): the card is only the
  // holder of its files and is moved through NO edit approval; the post is a Draft, and its own
  // quality check is its approval
  it('makes a draft post; the card is only its file holder and moves nowhere', async () => {
    const made = await upload()
    expect(made.status).toBe(200)
    expect(made.body.needs_approval).toBe(true)
    expect(items()[0].status).toBe('draft_uploaded')
    expect(made.body.post.stage).toBe('draft')
    expect(made.body.message).toContain('send it for quality check')
    const trail = (fake.rows('workflow_activity') as any[]).map(a => `${a.action}:${a.new_value ?? ''}`)
    expect(trail.some(t => t.startsWith('status_change'))).toBe(false)
  })

  it('makes the piece, the version and the post — even the quality reviewer’s upload is a draft', async () => {
    as(QA)
    const made = await upload()
    expect(made.status).toBe(200)
    expect(made.body.needs_approval).toBe(true)

    // an ORDINARY item: a work kind, no shoot, owned by whoever uploaded it
    expect(items()).toHaveLength(1)
    const item = items()[0]
    expect(item.title).toBe('spring launch')
    expect(item.content_type).toBe('static')
    expect(item.work_kind_id).toBe('k-edit')
    expect(item.batch_id ?? null).toBeNull()
    expect(item.owner_id).toBe(AM.id)
    // …left at draft: its status is never read by a posting page (SPEC §2.5)
    expect(item.status).toBe('draft_uploaded')

    // …with an ordinary version 1
    expect(versions()).toHaveLength(1)
    expect(versions()[0].version_number).toBe(1)
    expect(versions()[0].item_id).toBe(item.id)
    expect(versions()[0].files).toHaveLength(1)
    // the version says it was an upload the client was never asked about, so
    // the image editor's footer can tell it from a piece the client approved
    expect(isAdHocUploadVersion(versions()[0])).toBe(true)

    // …and the post, as a draft, holding the file
    expect(made.body.post.stage).toBe('draft')
    expect(made.body.post.slides[0].url).toBe(FILE.url)
    expect(made.body.post.item_id).toBe(item.id)
  })

  it('records the upload as this person’s own, and approves nothing on the card', async () => {
    as(QA)
    await upload()
    const log = fake.rows('workflow_activity') as any[]
    const trail = log.map(a => `${a.action}:${a.new_value ?? ''}`)
    expect(trail.some(t => t.startsWith('created'))).toBe(true)
    expect(trail.some(t => t.includes('approved_for_scheduling') || t.includes('quality_check'))).toBe(false)
    expect(log.filter(a => a.action !== 'notified').every(a => a.actor_id === AM.id)).toBe(true)
  })

  it('composes the post, and — as the quality reviewer — sends, passes and books it, each its own step', async () => {
    as(QA)
    const made = await upload()
    const id = made.body.post.id as string

    const composed = await compose(id, {
      caption: 'Doors open at six', channels: ['acc-1'], scheduled_for: IN_TWO_DAYS(),
    })
    expect(composed.status).toBe(200)

    // the upload IS the post (decision 7): its own quality check is its approval
    const sent = await act(id, 'send_to_qc')
    expect(sent.status, JSON.stringify(sent.body)).toBe(200)
    expect(sent.body.post.stage).toBe('quality_check')
    const passed = await act(id, 'pass')
    expect(passed.status, JSON.stringify(passed.body)).toBe(200)
    expect(passed.body.post.stage).toBe('ready')
    expect(passed.body.post.approval).toMatchObject({ by: AM.id, hat: 'quality_reviewer' })
    const booked = await act(id, 'book')
    expect(booked.status, JSON.stringify(booked.body)).toBe(200)
    expect(booked.body.post.stage).toBe('booked')
    expect(jobs()).toHaveLength(1)
  })
})

/* ── everybody else ─────────────────────────────────────────────────────── */

describe('a scheduler uploads the same file', () => {
  beforeEach(() => { as(SCHEDULER) })

  it('gets the piece and the post, and the post waits for the check', async () => {
    const made = await upload()
    expect(made.status).toBe(200)
    expect(made.body.needs_approval).toBe(true)
    // the upload lands in Draft and stays there until the scheduler presses Send for quality check
    expect(made.body.message).toContain('send it for quality check')
    expect(items()[0].status).toBe('draft_uploaded')
    expect(items()[0].owner_id).toBe(SCHEDULER.id)
    expect(made.body.post.stage).toBe('draft')
  })

  it('may still write the caption and the channels on the draft', async () => {
    const made = await upload()
    const composed = await compose(made.body.post.id as string, {
      caption: 'Doors open at six', channels: ['acc-1'],
    })
    expect(composed.status).toBe(200)
    expect(composed.body.post.caption).toBe('Doors open at six')
  })

  it('is REFUSED the short cut — booking it in without an approval', async () => {
    const made = await upload()
    const id = made.body.post.id as string
    await compose(id, { caption: 'Doors open at six', channels: ['acc-1'] })

    // it cannot be booked in behind the quality check's back
    expect((await act(id, 'book')).status).toBe(409)
    expect(jobs()).toHaveLength(0)
    // …and once it is at the quality check, a scheduler cannot pass their own post
    await compose(id, { scheduled_for: IN_TWO_DAYS() })
    const sent = await act(id, 'send_to_qc')
    expect(sent.status, JSON.stringify(sent.body)).toBe(200)
    const passed = await act(id, 'pass')
    expect(passed.status).toBe(403)
    expect(passed.body.code).toBe('not_allowed')
    expect(jobs()).toHaveLength(0)
  })
})

/* ── the client who signs everything off ────────────────────────────────── */

describe('a client who signs off every post', () => {
  beforeEach(() => {
    fake.restore()
    fake = seed({ client_approval_required: true })
    as(AM)
  })

  // the owner, 9 Sep 2026: an account manager's upload clears itself and
  // schedules straight out, "even when the client has that lock" — the
  // switch is the line under the button, not a second person to wait on
  it('sends the reviewer’s pass on to the client by default', async () => {
    as(QA)
    const made = await upload()
    expect(made.status).toBe(200)
    expect(made.body.needs_approval).toBe(true)
    expect(items()[0].status).toBe('draft_uploaded')

    const id = made.body.post.id as string
    await compose(id, { caption: 'Doors open at six', channels: ['acc-1'], scheduled_for: IN_TWO_DAYS() })
    // a client who signs every post off is "team then client" by default: the quality reviewer's
    // main button is "Passed — send to client", and a plain pass is refused for them (decision 13)
    expect((await act(id, 'send_to_qc')).status).toBe(200)
    const passed = await act(id, 'pass')
    expect(passed.status).toBe(409)
    expect(passed.body.code).toBe('steps')
    expect(jobs()).toHaveLength(0)
  })
})

/* ── what may be posted at all ──────────────────────────────────────────── */

describe('the files are checked before anything is written', () => {
  // the owner, 9 Sep 2026: a 1.4 GB C6437.MP4 finished uploading and was
  // refused with "too big to put on a post" by a 1 GB ceiling from before the
  // smaller-copy flow. The ceiling is the storage's now; what each network
  // takes of a big file is the channels' question, answered per channel.
  it('takes a video as big as the storage takes — a 1.4 GB master is a post', async () => {
    const { headStoredObject } = await import('../app/lib/storage')
    const head = headStoredObject as unknown as { mockImplementationOnce: (f: () => unknown) => void }
    head.mockImplementationOnce(async () => ({ contentType: 'video/mp4', bytes: 1_477_002_318 }))
    as(AM)
    const made = await upload({
      files: [{ url: `${BASE}/1712345678901-ab12cd-C6437.mp4`, name: 'C6437.MP4', type: 'video', bytes: 1_477_002_318 }],
    })
    expect(made.status).toBe(200)
    expect(items()).toHaveLength(1)
  })

  it('still refuses a file bigger than the storage could have taken', async () => {
    const { headStoredObject } = await import('../app/lib/storage')
    const head = headStoredObject as unknown as { mockImplementationOnce: (f: () => unknown) => void }
    head.mockImplementationOnce(async () => ({ contentType: 'video/mp4', bytes: 6 * 1024 * 1024 * 1024 }))
    as(AM)
    const made = await upload({
      files: [{ url: `${BASE}/1712345678901-ab12cd-huge.mp4`, name: 'huge.mp4', type: 'video', bytes: 6 * 1024 * 1024 * 1024 }],
    })
    expect(made.status).toBe(400)
    expect(String(made.body.error)).toContain('too big')
    expect(items()).toHaveLength(0)
  })

  it('refuses a URL that is not on our own storage', async () => {
    const bad = await upload({
      files: [{ ...FILE, url: 'https://somewhere-else.example/1712345678901-ab12cd-x.jpg' }],
    })
    expect(bad.status).toBe(400)
    expect(String(bad.body.error)).toContain('not one of ours')
    expect(items()).toHaveLength(0)
  })

  it('refuses an empty pick, and makes no piece for it', async () => {
    const none = await upload({ files: [] })
    expect(none.status).toBe(400)
    expect(items()).toHaveLength(0)
  })

  it('refuses a client this person is not on', async () => {
    fake.restore()
    fake = seedDb({
      clients: [
        { id: CLIENT, name: 'Acme', timezone: 'Australia/Melbourne' },
        { id: 'c2', name: 'Other', timezone: 'Australia/Melbourne' },
      ] as unknown as Row[],
      content_items: [],
      asset_versions: [],
      work_kinds: [{
        id: 'k-edit', slug: 'edit', name: 'Edit', default_roles: ['editor'],
        uses_media: true, color: 'zinc', active: true, sort_order: 1,
      }] as unknown as Row[],
      team_users: [{
        ...AM, active_status: true, employment_type: 'employee',
        timezone: 'Australia/Melbourne', client_id: null,
      }] as unknown as Row[],
      team_user_clients: [{ id: `${AM.id}__${CLIENT}`, team_user_id: AM.id, client_id: CLIENT }] as unknown as Row[],
      social_posts: [], publish_jobs: [], claim_locks: [], workflow_activity: [],
    })
    as(AM)
    const wrong = await upload({ client_id: 'c2' })
    expect(wrong.status).toBe(403)
    expect(items()).toHaveLength(0)
  })
})

/* ── an upload decides nothing about approval (review fix, 29 Sep 2026) ─── */

describe('an upload that carries an old "decision"', () => {
  it('is a draft post all the same — the card is not moved and nobody is asked', async () => {
    for (const who of [SCHEDULER, AM, QA]) {
      fake.restore()
      fake = seed()
      as(who)
      const made = await upload({ decision: 'approve', reviewer_ids: [AM.id], note: 'Have a look' })
      expect(made.status).toBe(200)
      expect(items()[0].status).toBe('draft_uploaded')
      expect(made.body.post.stage).toBe('draft')
      expect(made.body.needs_approval).toBe(true)
    }
  })
})

describe('an upload emails nobody (the owner, 15 Sep 2026; audit V12)', () => {
  it('no "ready for quality check" about a card nobody will see on Post approval', async () => {
    const { notify } = await import('../app/lib/mailer')
    vi.mocked(notify).mockClear()
    as(AM)
    const made = await upload()
    expect(made.status).toBe(200)
    await new Promise(r => setTimeout(r, 60))
    expect(vi.mocked(notify).mock.calls).toHaveLength(0)
    const log = fake.rows('workflow_activity') as any[]
    expect(log.map(a => a.new_value)).not.toContain('quality_check')
  })
})
