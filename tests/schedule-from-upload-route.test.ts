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
 *   an account manager uploads → the piece is made for them, at the state a
 *   post can go out from, with the sign-off recorded → the post is composed
 *   and booked in (dry run);
 *
 *   a scheduler uploads the same file → the same piece, the same post, and
 *   the short cut is REFUSED: their post still waits for the manager's check;
 *
 *   a client who signs off every post keeps the full flow for everybody.
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
const send = await import('../app/api/social/schedule/[id]/send/route')
const book = await import('../app/api/social/schedule/[id]/schedule/route')

/* ── the cast ───────────────────────────────────────────────────────────── */

const CLIENT = 'c1'
const AM = { id: 'u-am', role: 'account_manager', email: 'am@x.invalid', name: 'Ada', clerk_user_id: null }
const SCHEDULER = { id: 'u-sch', role: 'scheduler', email: 'sch@x.invalid', name: 'Sam', clerk_user_id: null }

const as = (who: typeof AM) => { Object.assign(h.user, who) }

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

const sendIt = (id: string, body: Record<string, unknown> = {}) => json(
  send.POST(new Request('https://x.test/send', {
    method: 'POST', body: JSON.stringify(body),
  }), params(id)))

const bookIn = (id: string) => json(
  book.POST(new Request('https://x.test/schedule', { method: 'POST' }), params(id)))

const items = () => fake.rows('content_items') as any[]
const versions = () => fake.rows('asset_versions') as any[]
const jobs = () => fake.rows('publish_jobs') as any[]

beforeEach(() => {
  process.env.PUBLISH_DRY_RUN = '1'
  process.env.ZERNIO_API_KEY = 'not-used-in-a-dry-run'
  as(AM)
  fake = seed()
})
afterEach(() => {
  fake.restore()
  delete process.env.PUBLISH_DRY_RUN
  vi.clearAllMocks()
})

/* ── the account manager ────────────────────────────────────────────────── */

describe('an account manager posts a file with no piece behind it', () => {
  it('makes the piece, the version and the post — and needs nobody', async () => {
    const made = await upload()
    expect(made.status).toBe(200)
    expect(made.body.needs_approval).toBe(false)

    // an ORDINARY item: a work kind, no shoot, owned by whoever uploaded it
    expect(items()).toHaveLength(1)
    const item = items()[0]
    expect(item.title).toBe('spring launch')
    expect(item.content_type).toBe('static')
    expect(item.work_kind_id).toBe('k-edit')
    expect(item.batch_id ?? null).toBeNull()
    expect(item.owner_id).toBe(AM.id)
    // …already at the state a post can go out from
    expect(item.status).toBe('approved_for_scheduling')

    // …with an ordinary version 1
    expect(versions()).toHaveLength(1)
    expect(versions()[0].version_number).toBe(1)
    expect(versions()[0].item_id).toBe(item.id)
    expect(versions()[0].files).toHaveLength(1)
    // the version says it was an upload the client was never asked about, so
    // the image editor's footer can tell it from a piece the client approved
    expect(isAdHocUploadVersion(versions()[0])).toBe(true)

    // …and the post, as a draft, holding the file
    expect(made.body.post.status).toBe('draft')
    expect(made.body.post.slides[0].url).toBe(FILE.url)
    expect(made.body.post.item_id).toBe(item.id)
  })

  it('records the sign-off as this person’s own, on the ordinary edge', async () => {
    await upload()
    const log = fake.rows('workflow_activity') as any[]
    const trail = log.map(a => `${a.action}:${a.new_value ?? ''}`)
    expect(trail.some(t => t.startsWith('created'))).toBe(true)
    expect(trail.some(t => t.includes('approved_for_scheduling'))).toBe(true)
    // the sign-off is THIS person's, never the app's
    expect(log.every(a => a.actor_id === AM.id)).toBe(true)
  })

  it('composes and books the post in, with no approval step in the way', async () => {
    const made = await upload()
    const id = made.body.post.id as string

    const composed = await compose(id, {
      caption: 'Doors open at six', channels: ['acc-1'], scheduled_for: IN_TWO_DAYS(),
    })
    expect(composed.status).toBe(200)

    // 'direct': the post's own send-and-approve, performed for them
    const sent = await sendIt(id, { mode: 'direct' })
    expect(sent.status).toBe(200)
    expect(sent.body.post.status).toBe('scheduled')
    expect(sent.body.post.approval_mode).toBe('self')
    expect(sent.body.post.approved_by).toBe(AM.id)
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
    expect(made.body.message).toContain('account manager checks it')
    expect(items()[0].status).toBe('internal_review')
    expect(items()[0].owner_id).toBe(SCHEDULER.id)
    expect(made.body.post.status).toBe('draft')
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

    const sent = await sendIt(id, { mode: 'direct' })
    expect(sent.status).toBe(403)
    expect(String(sent.body.error)).toContain('account manager')
    expect(jobs()).toHaveLength(0)

    // …and it cannot be booked in behind the approval's back either
    expect((await bookIn(id)).status).toBe(409)
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

  it('keeps the full flow, even for an account manager', async () => {
    const made = await upload()
    expect(made.status).toBe(200)
    expect(made.body.needs_approval).toBe(true)
    expect(made.body.message).toContain('signs off every post')
    expect(items()[0].status).toBe('internal_review')

    const id = made.body.post.id as string
    await compose(id, { caption: 'Doors open at six', channels: ['acc-1'] })
    const sent = await sendIt(id, { mode: 'direct' })
    expect(sent.status).toBe(403)
    expect(jobs()).toHaveLength(0)
  })
})

/* ── what may be posted at all ──────────────────────────────────────────── */

describe('the files are checked before anything is written', () => {
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
