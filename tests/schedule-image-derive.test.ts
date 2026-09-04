import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'

/**
 * A CROP KEEPS THE CLIENT'S APPROVAL. A FILTER DOES NOT.
 *
 * The editor decides which of the two an edit is (`saveDecision`, tested
 * purely next door) and then calls one of two endpoints. This file is the
 * other half of that promise: that the crop endpoint really does write into
 * the version the client already approved and leave the approval where it is,
 * that it cannot be talked into smuggling in a file from somewhere else, and
 * that a post built from the old file follows the crop rather than publishing
 * the uncropped picture.
 *
 * The real `@/lib/db` over an in-memory Realtime Database. Drive, the video
 * encoder and the live channel are stubbed — none of them is what is being
 * tested and all of them would reach the network.
 */

const h = vi.hoisted(() => ({
  user: { id: '', role: '', email: '', name: '', clerk_user_id: null } as Record<string, unknown>,
  mirrored: [] as unknown[],
  /** what the storage host says about the file being written in */
  head: { contentType: 'image/jpeg', bytes: 240_000 } as
    { contentType: string | null; bytes: number | null } | null,
  /** files thrown away because the save they were uploaded for did not happen */
  deleted: [] as string[],
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
    guard: async () => null,
    roleSatisfies: () => true,
  }
})
vi.mock('../app/lib/mailer', () => ({
  notify: vi.fn(async () => {}),
  renderEmail: (_s: string, body: string) => body,
  escapeHtml: (s: string) => s,
}))
vi.mock('../app/lib/gdrive-mirror', () => ({
  mirrorVersionSlides: vi.fn((...a: unknown[]) => { h.mirrored.push(a) }),
  mirrorLatestVersionSoon: vi.fn(),
  mirrorRawAssets: vi.fn(),
  newRawAssets: () => [],
}))
vi.mock('../app/lib/stream', () => ({ previewVideos: vi.fn() }))
/**
 * The bucket, with the network taken out — but NOT the guard.
 *
 * `ourStorageUrl` (the thing actually under test) stays real, in
 * `storage-core.ts`; only the two calls that would open a socket are answered
 * from memory. Mocking the guard as well would have left exactly the hole this
 * file exists to close.
 */
vi.mock('../app/lib/storage', () => ({
  MAX_DERIVED_BYTES: 64 * 1024 * 1024,
  publicBase: () => 'https://media.mdmmarketing.com.au',
  headStoredObject: async () => h.head,
  deleteStoredObject: async (url: string) => { h.deleted.push(url) },
}))
vi.mock('../app/lib/production-live', () => ({
  announceItemChange: vi.fn(), announceBatchChange: vi.fn(),
}))
vi.mock('../lib/live', () => ({ announce: vi.fn(), announceAfter: vi.fn() }))
vi.mock('../app/inngest/client', () => ({ inngest: { send: vi.fn(async () => ({})) } }))

const deriveRoute = await import('../app/api/social/schedule/derive/route')

const CLIENT = 'c1'
const OTHER_CLIENT = 'c2'
const ITEM = 'a1b2c3d4-0000-4000-8000-000000000001'
const AM = { id: 'u-am', role: 'account_manager', email: 'am@x.invalid', name: 'Ada', clerk_user_id: null }
const SCHEDULER = { id: 'u-sch', role: 'scheduler', email: 'sch@x.invalid', name: 'Sam', clerk_user_id: null }
const STRANGER = { id: 'u-ed2', role: 'editor', email: 'ed2@x.invalid', name: 'Kit', clerk_user_id: null }

const as = (who: typeof AM) => { Object.assign(h.user, who) }

const ONE = 'https://media.mdmmarketing.com.au/1756000000000-a1b2c3-one.jpg'
const TWO = 'https://media.mdmmarketing.com.au/1756000000001-a1b2c4-two.jpg'
const CLIP = 'https://media.mdmmarketing.com.au/1756000000002-a1b2c5-clip.mp4'
const CROPPED = 'https://media.mdmmarketing.com.au/1756000000003-a1b2c6-one_cropped.jpg'
const COVER = 'https://media.mdmmarketing.com.au/1756000000004-a1b2c7-clip_cover.jpg'

const APPROVED = [
  { url: ONE, name: 'one.jpg', type: 'image' as const },
  { url: TWO, name: 'two.jpg', type: 'image' as const },
]

let fake: ReturnType<typeof seedDb>

function seed(opts: { slides?: unknown[]; posts?: Row[]; extraVersions?: Row[] } = {}) {
  return seedDb({
    clients: [
      { id: CLIENT, name: 'Acme', timezone: 'Australia/Melbourne' },
      { id: OTHER_CLIENT, name: 'Other', timezone: 'Australia/Melbourne' },
    ] as unknown as Row[],
    content_items: [{
      id: ITEM, client_id: CLIENT, title: 'The launch post',
      status: 'approved_for_scheduling', content_type: 'carousel',
      owner_id: 'u-ed', scheduler_ids: [], caption: 'Hello',
      current_version_number: 1, posting_approval_state: 'approved',
      posting_approved_by: AM.id, posting_approved_at: '2026-09-01T00:00:00.000Z',
      platform_targets: ['instagram'], drive_folder_id: 'folder-1',
    }] as unknown as Row[],
    asset_versions: [{
      id: `${ITEM}__1`, item_id: ITEM, version_number: 1,
      files: opts.slides ?? APPROVED,
      file_url: (opts.slides ?? APPROVED)[0] && (opts.slides ?? APPROVED as any)[0].url,
      dropbox_url: '', drive_url: '', notes: null, uploaded_by: 'u-ed',
    }, ...(opts.extraVersions ?? [])] as unknown as Row[],
    social_accounts: [{
      id: 'acc-1', client_id: CLIENT, platform: 'instagram', provider_account_id: 'prov-1',
      name: 'Acme on Instagram', username: 'acme', avatar_url: null, active: true,
    }] as unknown as Row[],
    team_users: [AM, SCHEDULER, STRANGER].map(u => ({
      ...u, active_status: true, employment_type: 'employee',
      timezone: 'Australia/Melbourne', client_id: null,
    })) as unknown as Row[],
    team_user_clients: [
      { id: `${AM.id}__${CLIENT}`, team_user_id: AM.id, client_id: CLIENT },
      { id: `${STRANGER.id}__${OTHER_CLIENT}`, team_user_id: STRANGER.id, client_id: OTHER_CLIENT },
    ] as unknown as Row[],
    social_posts: opts.posts ?? [],
    schedule_notes: [],
    publish_jobs: [],
    claim_locks: [],
    workflow_activity: [],
    notification_log: [],
  })
}

const json = async (res: Response | Promise<Response>) => {
  const r = await res
  return { status: r.status, body: await r.json() as any }
}

const derive = (body: Record<string, unknown>) => json(
  deriveRoute.POST(new Request('https://x.test/api/social/schedule/derive', {
    method: 'POST', body: JSON.stringify(body),
  })))

const item = () => fake.rows('content_items').find(i => i.id === ITEM) as any
const version = () => (fake.rows('asset_versions') as any[]).find(v => v.id === `${ITEM}__1`)
const posts = () => fake.rows('social_posts') as any[]

beforeEach(() => {
  h.mirrored = []
  h.deleted = []
  h.head = { contentType: 'image/jpeg', bytes: 240_000 }
  as(SCHEDULER)
  fake = seed()
})
afterEach(() => {
  fake.restore()
  vi.clearAllMocks()
})

describe('a crop', () => {
  it('replaces the file inside the approved version and touches no approval', async () => {
    const { status, body } = await derive({
      item_id: ITEM, version_number: 1, from_url: ONE, to_url: CROPPED, kind: 'crop',
    })
    expect(status).toBe(200)
    expect(body.version_number).toBe(1)
    expect(body.message).toMatch(/keeps the client’s approval/)

    // the SAME version, not a new one
    expect((fake.rows('asset_versions') as any[]).filter(v => v.item_id === ITEM)).toHaveLength(1)
    expect(version().files.map((s: any) => s.url)).toEqual([CROPPED, TWO])
    // slide one is also the legacy single-file column, and it moved with it
    expect(version().file_url).toBe(CROPPED)

    // the piece did not go back to the client, and the final-post sign-off stands
    expect(item().status).toBe('approved_for_scheduling')
    expect(item().posting_approval_state).toBe('approved')
    expect(item().posting_approved_by).toBe(AM.id)

    // it is filed in Drive like any other version change
    expect(h.mirrored).toHaveLength(1)
  })

  it('leaves a post that has already gone out exactly as it was', async () => {
    fake.restore()
    fake = seed({
      posts: [
        {
          id: 'post-out', client_id: CLIENT, item_id: ITEM, version_id: `${ITEM}__1`,
          version_number: 1, slides: APPROVED, caption: 'Hello', per_channel: {},
          channels: ['acc-1'], scheduled_for: null, timezone: 'Australia/Melbourne',
          status: 'published', publish_job_ids: [], created_by: SCHEDULER.id,
          created_at: '2026-09-01T00:00:00.000Z', updated_at: '2026-09-01T00:00:00.000Z',
        },
        {
          id: 'post-plan', client_id: CLIENT, item_id: ITEM, version_id: `${ITEM}__1`,
          version_number: 1, slides: APPROVED, caption: 'Hello', per_channel: {},
          channels: ['acc-1'], scheduled_for: null, timezone: 'Australia/Melbourne',
          status: 'draft', publish_job_ids: [], created_by: SCHEDULER.id,
          created_at: '2026-09-01T00:00:00.000Z', updated_at: '2026-09-01T00:00:00.000Z',
        },
      ] as unknown as Row[],
    })
    await derive({ item_id: ITEM, from_url: ONE, to_url: CROPPED, kind: 'crop' })

    const out = posts().find((p: any) => p.id === 'post-out')
    const plan = posts().find((p: any) => p.id === 'post-plan')
    // `social_posts.slides` is the record of what was PUBLISHED; rewriting it
    // because somebody cropped the same picture for reuse would make the
    // preview grid show history that did not happen
    expect(out.slides.map((s: any) => s.url)).toEqual([ONE, TWO])
    // a post that can still change is still a plan, and follows the crop
    expect(plan.slides.map((s: any) => s.url)).toEqual([CROPPED, TWO])
  })

  it('is followed by a post already built from the old file', async () => {
    fake.restore()
    fake = seed({
      posts: [{
        id: 'post-1', client_id: CLIENT, item_id: ITEM, version_id: `${ITEM}__1`,
        version_number: 1, slides: APPROVED, caption: 'Hello', per_channel: {},
        channels: ['acc-1'], scheduled_for: null, timezone: 'Australia/Melbourne',
        status: 'draft', publish_job_ids: [], created_by: SCHEDULER.id,
        created_at: '2026-09-01T00:00:00.000Z', updated_at: '2026-09-01T00:00:00.000Z',
      }] as unknown as Row[],
    })
    await derive({ item_id: ITEM, from_url: ONE, to_url: CROPPED, kind: 'crop' })
    // without this the version says "cropped" and the UNCROPPED file is what
    // would actually be published
    expect(posts()[0].slides.map((s: any) => s.url)).toEqual([CROPPED, TWO])
  })

  it('refuses a file that is not part of this piece', async () => {
    const { status, body } = await derive({
      item_id: ITEM, from_url: 'https://media.mdmmarketing.com.au/elsewhere.jpg',
      to_url: CROPPED, kind: 'crop',
    })
    expect(status).toBe(409)
    expect(body.error).toMatch(/not part of this piece/)
  })

  /**
   * THE HOLE THIS CLOSES.
   *
   * The route swaps the new file into a version that is already approved and
   * repoints the live post at it, without touching the approval. So anything
   * it accepts is published under a yes nobody gave for it. Checking the
   * scheme alone — which is all it used to do — meant any file on the internet
   * would go in, and the test that claimed otherwise only tried `blob:` and
   * `data:`.
   */
  it('refuses a file that is not on our own storage, however well formed', async () => {
    const foreign = [
      'https://evil.example/1756000000000-a1b2c3-one.jpg',
      'https://media.mdmmarketing.com.au.evil.example/1756000000000-a1b2c3-one.jpg',
      'blob:https://x/1',
      'data:image/png;base64,AAA',
      'http://media.mdmmarketing.com.au/1756000000000-a1b2c3-one.jpg',
      '',
    ]
    for (const bad of foreign) {
      const { status, body } = await derive({
        item_id: ITEM, from_url: ONE, to_url: bad, kind: 'crop',
      })
      expect(status, bad).toBe(400)
      expect(body.error).toMatch(/not one of our own files/)
    }
    expect(version().files.map((s: any) => s.url)).toEqual([ONE, TWO])
  })

  it('refuses a key that is not one we minted, or that climbs out of the bucket', async () => {
    const bad = [
      'https://media.mdmmarketing.com.au/../secrets/one.jpg',
      'https://media.mdmmarketing.com.au/1756000000000-a1b2c3-../one.jpg',
      'https://media.mdmmarketing.com.au//1756000000000-a1b2c3-one.jpg',
      'https://media.mdmmarketing.com.au/one.jpg',
      'https://media.mdmmarketing.com.au/uploads/1756000000000-a1b2c3-one.jpg',
    ]
    for (const url of bad) {
      const { status } = await derive({ item_id: ITEM, from_url: ONE, to_url: url, kind: 'crop' })
      expect(status, url).toBe(400)
    }
    expect(version().files.map((s: any) => s.url)).toEqual([ONE, TWO])
  })

  it('refuses an extension a picture cannot have', async () => {
    for (const url of [
      'https://media.mdmmarketing.com.au/1756000000000-a1b2c3-one.svg',
      'https://media.mdmmarketing.com.au/1756000000000-a1b2c3-one.html',
      'https://media.mdmmarketing.com.au/1756000000000-a1b2c3-one.mp4',
    ]) {
      const { status } = await derive({ item_id: ITEM, from_url: ONE, to_url: url, kind: 'crop' })
      expect(status, url).toBe(400)
    }
  })

  it('refuses a file the storage host says is not a picture, or is enormous', async () => {
    h.head = { contentType: 'text/html', bytes: 900 }
    let res = await derive({ item_id: ITEM, from_url: ONE, to_url: CROPPED, kind: 'crop' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/not a picture/)

    h.head = { contentType: 'image/jpeg', bytes: 700 * 1024 * 1024 }
    res = await derive({ item_id: ITEM, from_url: ONE, to_url: CROPPED, kind: 'crop' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/too big/)

    h.head = null
    res = await derive({ item_id: ITEM, from_url: ONE, to_url: CROPPED, kind: 'crop' })
    expect(res.status).toBe(400)

    expect(version().files.map((s: any) => s.url)).toEqual([ONE, TWO])
  })

  it('throws away the upload when the save it was for does not happen', async () => {
    h.head = { contentType: 'text/html', bytes: 900 }
    await derive({ item_id: ITEM, from_url: ONE, to_url: CROPPED, kind: 'crop' })
    // the browser has to upload before it can save, so a refusal afterwards
    // would otherwise leave bytes nothing points at
    expect(h.deleted).toEqual([CROPPED])
  })

  it('is refused to somebody who is not on this client', async () => {
    as(STRANGER)
    const { status } = await derive({
      item_id: ITEM, from_url: ONE, to_url: CROPPED, kind: 'crop',
    })
    expect(status).toBeGreaterThanOrEqual(400)
    expect(version().files.map((s: any) => s.url)).toEqual([ONE, TWO])
  })

  it('writes into the version that HOLDS the file, not simply the newest', async () => {
    // a second, NEWER version exists that does not carry this file at all
    fake.restore()
    fake = seed({
      extraVersions: [{
        id: `${ITEM}__2`, item_id: ITEM, version_number: 2,
        files: [{ url: TWO, name: 'two.jpg', type: 'image' }], file_url: TWO,
        dropbox_url: '', drive_url: '', notes: null, uploaded_by: 'u-ed',
      }] as unknown as Row[],
    })
    const { status, body } = await derive({
      item_id: ITEM, from_url: ONE, to_url: CROPPED, kind: 'crop',
    })
    expect(status).toBe(200)
    expect(body.version_number).toBe(1)
    expect(version().files.map((s: any) => s.url)).toEqual([CROPPED, TWO])
  })
})

describe('a video’s cover frame and trim marks', () => {
  beforeEach(() => {
    fake.restore()
    fake = seed({ slides: [{ url: CLIP, name: 'clip.mp4', type: 'video' }] })
  })

  it('are saved on the version, and the approval stays because the file did not change', async () => {
    const { status, body } = await derive({
      item_id: ITEM, from_url: CLIP, cover_url: COVER,
      trim_start: 3.2, trim_end: 18.5, kind: 'video',
    })
    expect(status).toBe(200)
    expect(body.message).toMatch(/approval stays/)
    expect(version().cover_url).toBe(COVER)
    expect(version().trim_start).toBe(3.2)
    expect(version().trim_end).toBe(18.5)
    expect(version().files.map((s: any) => s.url)).toEqual([CLIP])
    expect(item().posting_approval_state).toBe('approved')
    // nothing was re-encoded and nothing was re-filed: the file is untouched
    expect(h.mirrored).toHaveLength(0)
  })

  it('refuses a cover that did not finish uploading', async () => {
    const { status } = await derive({
      item_id: ITEM, from_url: CLIP, cover_url: 'blob:https://x/1', kind: 'video',
    })
    expect(status).toBe(400)
    expect(version().cover_url).toBeFalsy()
  })
})
