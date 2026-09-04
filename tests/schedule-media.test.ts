import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'

/**
 * MEDIA THAT DID NOT COME FROM THE APPROVED VERSION.
 *
 * The composer can reach a Google Drive file or an upload from somebody's
 * laptop, and the whole promise of this feature is that neither is quietly
 * slipped into a post the client already said yes to. This file pins the
 * three things that promise rests on:
 *
 *   1. a genuinely new FILE makes a new version and sends the piece back to
 *      the client — through the state machine, on the `auto` edge;
 *   2. a REORDER makes nothing: it is an edit of the post. (Without this,
 *      dragging one slide left made v5, dragging it back made v6, each with
 *      its own Drive mirror and its own encode.)
 *   3. neither door is open to somebody who may not touch this client's work.
 *
 * The real `@/lib/db` over an in-memory Realtime Database; Drive, the video
 * encoder, the mailer and the live channel are stubbed, because none of them
 * is what is being tested and all of them would reach the network.
 */

const h = vi.hoisted(() => ({
  user: { id: '', role: '', email: '', name: '', clerk_user_id: null } as Record<string, unknown>,
  mirrored: [] as unknown[],
  encoded: [] as unknown[],
  emails: [] as Record<string, unknown>[],
  drive: { list: null as unknown, imported: [] as unknown[] },
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
  notify: vi.fn(async (m: Record<string, unknown>) => { h.emails.push(m) }),
  renderEmail: (_s: string, body: string) => body,
  escapeHtml: (s: string) => s,
}))
vi.mock('../app/lib/gdrive-mirror', () => ({
  mirrorVersionSlides: vi.fn((...a: unknown[]) => { h.mirrored.push(a) }),
  mirrorLatestVersionSoon: vi.fn(),
  mirrorRawAssets: vi.fn(),
  newRawAssets: () => [],
}))
vi.mock('../app/lib/stream', () => ({
  previewVideos: vi.fn((...a: unknown[]) => { h.encoded.push(a) }),
}))
vi.mock('../app/lib/schedule-drive', () => ({
  listDriveMedia: vi.fn(async () => h.drive.list),
  importDriveFile: vi.fn(async (id: string) => {
    h.drive.imported.push(id)
    return {
      ok: true,
      slide: { url: `https://media.mdmmarketing.com.au/drive-${id}.jpg`, name: `${id}.jpg`, type: 'image' },
    }
  }),
  DRIVE_IMPORT_LIMIT_BYTES: 100 * 1024 * 1024,
}))
vi.mock('../app/lib/production-live', () => ({
  announceItemChange: vi.fn(), announceBatchChange: vi.fn(),
}))
/** the bucket, with the network taken out — the GUARD (`storage-core.ts`)
 *  stays real, because what may be deleted is the point of these cases */
vi.mock('../app/lib/storage', () => ({
  MAX_DERIVED_BYTES: 64 * 1024 * 1024,
  publicBase: () => 'https://media.mdmmarketing.com.au',
  headStoredObject: async () => ({ contentType: 'image/jpeg', bytes: 1000 }),
  deleteStoredObject: async (url: string) => { h.deleted.push(url) },
}))
vi.mock('../lib/live', () => ({ announce: vi.fn(), announceAfter: vi.fn() }))
vi.mock('../app/inngest/client', () => ({ inngest: { send: vi.fn(async () => ({})) } }))

const mediaRoute = await import('../app/api/social/schedule/media/route')
const driveRoute = await import('../app/api/social/schedule/drive/route')
const scheduleRoute = await import('../app/api/social/schedule/route')
const lib = await import('../app/lib/social-schedule')

/* ── the cast ───────────────────────────────────────────────────────────── */

const CLIENT = 'c1'
const OTHER_CLIENT = 'c2'
const ITEM = 'a1b2c3d4-0000-4000-8000-000000000001'
const AM = { id: 'u-am', role: 'account_manager', email: 'am@x.invalid', name: 'Ada', clerk_user_id: null }
const SCHEDULER = { id: 'u-sch', role: 'scheduler', email: 'sch@x.invalid', name: 'Sam', clerk_user_id: null }
const OWNER = { id: 'u-ed', role: 'editor', email: 'ed@x.invalid', name: 'Eden', clerk_user_id: null }
const STRANGER = { id: 'u-ed2', role: 'editor', email: 'ed2@x.invalid', name: 'Kit', clerk_user_id: null }
const CLIENT_USER = { id: 'u-cl', role: 'client', email: 'buyer@x.invalid', name: 'Robin', clerk_user_id: null }

const as = (who: typeof AM) => { Object.assign(h.user, who) }

const APPROVED = [
  { url: 'https://media.mdmmarketing.com.au/one.jpg', name: 'one.jpg', type: 'image' as const },
  { url: 'https://media.mdmmarketing.com.au/two.jpg', name: 'two.jpg', type: 'image' as const },
]
const NEW_FILE = {
  url: 'https://media.mdmmarketing.com.au/three.jpg', name: 'three.jpg', type: 'image' as const,
}

let fake: ReturnType<typeof seedDb>

function seed(itemPatch: Record<string, unknown> = {}) {
  return seedDb({
    clients: [
      { id: CLIENT, name: 'Acme', timezone: 'Australia/Melbourne' },
      { id: OTHER_CLIENT, name: 'Other', timezone: 'Australia/Melbourne' },
    ] as unknown as Row[],
    content_items: [{
      id: ITEM, client_id: CLIENT, title: 'The launch post',
      status: 'approved_for_scheduling', content_type: 'carousel',
      owner_id: OWNER.id, scheduler_ids: [], caption: 'Hello',
      current_version_number: 1, posting_approval_state: null,
      platform_targets: ['instagram'], drive_folder_id: 'folder-1',
      ...itemPatch,
    }] as unknown as Row[],
    asset_versions: [{
      id: `${ITEM}__1`, item_id: ITEM, version_number: 1, files: APPROVED,
      file_url: APPROVED[0].url, dropbox_url: '', drive_url: '', notes: null,
      uploaded_by: OWNER.id,
    }] as unknown as Row[],
    social_accounts: [{
      id: 'acc-1', client_id: CLIENT, platform: 'instagram', provider_account_id: 'prov-1',
      name: 'Acme on Instagram', username: 'acme', avatar_url: null, active: true,
    }] as unknown as Row[],
    team_users: [AM, SCHEDULER, OWNER, STRANGER, CLIENT_USER].map(u => ({
      ...u, active_status: true, employment_type: 'employee',
      timezone: 'Australia/Melbourne', client_id: u.role === 'client' ? CLIENT : null,
    })) as unknown as Row[],
    team_user_clients: [
      ...[AM, OWNER].map(u => ({ id: `${u.id}__${CLIENT}`, team_user_id: u.id, client_id: CLIENT })),
      { id: `${STRANGER.id}__${OTHER_CLIENT}`, team_user_id: STRANGER.id, client_id: OTHER_CLIENT },
    ] as unknown as Row[],
    social_posts: [],
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

const saveMedia = (body: Record<string, unknown>) => json(
  mediaRoute.POST(new Request('https://x.test/api/social/schedule/media', {
    method: 'POST', body: JSON.stringify(body),
  })))

const createPost = () => json(
  scheduleRoute.POST(new Request('https://x.test/api/social/schedule', {
    method: 'POST',
    body: JSON.stringify({
      item_id: ITEM, slides: APPROVED, caption: 'Hello everyone',
      channels: ['acc-1'],
      scheduled_for: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    }),
  })))

/** The transition's notifications are fire-and-forget (`void (async () => …)`
 *  inside performTransition), so the route answers before the last email is
 *  written. Let the queue drain before looking at it. */
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 5)) }

const item = () => fake.rows('content_items').find(i => i.id === ITEM) as any
const versions = () => (fake.rows('asset_versions') as any[]).filter(v => v.item_id === ITEM)
const posts = () => fake.rows('social_posts') as any[]

beforeEach(() => {
  h.mirrored = []; h.encoded = []; h.emails = []; h.deleted = []
  h.drive = { list: { ok: true, files: [], folderId: 'folder-1' }, imported: [] }
  as(SCHEDULER)
  fake = seed()
})
afterEach(() => {
  fake.restore()
  vi.clearAllMocks()
})

/* ── a new file ─────────────────────────────────────────────────────────── */

describe('a file the client has never seen', () => {
  it('becomes a new version and sends the piece back to them', async () => {
    const { status, body } = await saveMedia({
      item_id: ITEM, files: [...APPROVED, NEW_FILE],
    })
    expect(status).toBe(200)
    expect(body.created).toBe(true)
    expect(body.version_number).toBe(2)
    expect(body.status).toBe('client_review')
    expect(body.message).toMatch(/client has to approve it/)

    expect(versions()).toHaveLength(2)
    expect(item().status).toBe('client_review')
    // the file is filed and the video encoder is asked, exactly as an upload
    // on the item page would
    expect(h.mirrored).toHaveLength(1)
    expect(h.encoded).toHaveLength(1)
  })

  it('tells the client, the manager and the editor — the silence was the bug', async () => {
    as(SCHEDULER)
    await saveMedia({ item_id: ITEM, files: [...APPROVED, NEW_FILE] })
    await settle()
    const to = h.emails.map(e => String(e.recipientEmail)).sort()
    expect(to).toContain(CLIENT_USER.email)
    expect(to).toContain(AM.email)
    expect(to).toContain(OWNER.email)
  })

  it('says WHY, in words a client understands', async () => {
    await saveMedia({ item_id: ITEM, files: [...APPROVED, NEW_FILE] })
    await settle()
    const toClient = h.emails.find(e => e.recipientEmail === CLIENT_USER.email)
    expect(String(toClient?.bodyHtml)).toMatch(/New media was added — please take a look/)
  })

  it('takes the final-post approval back, because it was given to other media', async () => {
    fake.restore()
    fake = seed({ posting_approval_state: 'approved', posting_approved_by: AM.id })
    await saveMedia({ item_id: ITEM, files: [...APPROVED, NEW_FILE] })
    expect(item().posting_approval_state).toBe('pending')
    // …and the record of who gave it goes with it (the store drops a null
    // rather than writing one, so "nothing" is what is checked)
    expect(item().posting_approved_by ?? null).toBeNull()
  })

  it('carries the arrangement onto the post and un-sends it', async () => {
    const made = await createPost()
    const id = made.body.post.id
    const saved = await saveMedia({ item_id: ITEM, post_id: id, files: [...APPROVED, NEW_FILE] })
    expect(saved.status).toBe(200)
    const p = posts().find(x => x.id === id)
    expect(p.slides.map((s: any) => s.name)).toEqual(['one.jpg', 'two.jpg', 'three.jpg'])
    expect(p.version_number).toBe(2)
    expect(p.status).toBe('draft')
  })

  it('refuses an empty set rather than saving a post with nothing in it', async () => {
    const { status, body } = await saveMedia({ item_id: ITEM, files: [] })
    expect(status).toBe(400)
    expect(String(body.error ?? body.problems?.[0])).toMatch(/at least one photo or video/)
    expect(versions()).toHaveLength(1)
  })
})

/* ── nothing new ────────────────────────────────────────────────────────── */

describe('a reorder is not a version', () => {
  it('reordering the approved files makes nothing', async () => {
    const { status, body } = await saveMedia({
      item_id: ITEM, files: [APPROVED[1], APPROVED[0]],
    })
    expect(status).toBe(200)
    expect(body.created).toBe(false)
    expect(body.message).toMatch(/does not need to look again/)
    expect(versions()).toHaveLength(1)
    expect(item().status).toBe('approved_for_scheduling')
    expect(h.mirrored).toHaveLength(0)
    expect(h.encoded).toHaveLength(0)
    expect(h.emails).toHaveLength(0)
  })

  it('taking one out makes nothing either', async () => {
    // on a single-picture piece, because a CAROUSEL with one card is refused
    // outright — a different rule, and a correct one
    fake.restore()
    fake = seed({ content_type: 'static' })
    const { body } = await saveMedia({ item_id: ITEM, files: [APPROVED[0]] })
    expect(body.created).toBe(false)
    expect(versions()).toHaveLength(1)
  })

  it('THE LOOP THAT MINTED VERSIONS: reorder, save, reorder, save', async () => {
    // the file arrives once…
    await saveMedia({ item_id: ITEM, files: [...APPROVED, NEW_FILE] })
    expect(versions()).toHaveLength(2)
    // …and every rearrangement of it afterwards is an edit, however many
    // times somebody changes their mind. The item is now at client_review,
    // where the approved set reads empty — which is exactly the state that
    // used to make everything look new.
    await saveMedia({ item_id: ITEM, files: [NEW_FILE, ...APPROVED] })
    await saveMedia({ item_id: ITEM, files: [APPROVED[1], NEW_FILE, APPROVED[0]] })
    expect(versions()).toHaveLength(2)
    expect(h.emails.filter(e => e.recipientEmail === CLIENT_USER.email)).toHaveLength(1)
  })

  it('keeps the post where it stood — a reorder does not un-send it', async () => {
    const made = await createPost()
    const id = made.body.post.id
    await saveMedia({ item_id: ITEM, post_id: id, files: [APPROVED[1], APPROVED[0]] })
    const p = posts().find(x => x.id === id)
    expect(p.slides.map((s: any) => s.name)).toEqual(['two.jpg', 'one.jpg'])
    expect(p.version_number).toBe(1)
  })
})

/* ── who may open these doors ───────────────────────────────────────────── */

describe('the two new routes are gated like every other one', () => {
  it('a client account cannot reach either', async () => {
    as(CLIENT_USER)
    expect((await saveMedia({ item_id: ITEM, files: [NEW_FILE] })).status).toBe(403)
    expect((await json(driveRoute.GET(
      new Request(`https://x.test/drive?itemId=${ITEM}`)))).status).toBe(403)
    expect((await json(driveRoute.POST(new Request('https://x.test/drive', {
      method: 'POST', body: JSON.stringify({ item_id: ITEM, file_ids: ['f1'] }),
    })))).status).toBe(403)
  })

  it('somebody on another client is refused the item, not the route', async () => {
    as(STRANGER)
    // 404, not 403: `loadItemForUser` does not confirm that a piece it will
    // not show you exists — the same answer the item page gives, and the same
    // one both of these routes inherit by going through it
    expect((await saveMedia({ item_id: ITEM, files: [NEW_FILE] })).status).toBe(404)
    expect((await json(driveRoute.GET(
      new Request(`https://x.test/drive?itemId=${ITEM}`)))).status).toBe(404)
    expect((await json(driveRoute.POST(new Request('https://x.test/drive', {
      method: 'POST', body: JSON.stringify({ item_id: ITEM, file_ids: ['f1'] }),
    })))).status).toBe(404)
    expect(versions()).toHaveLength(1)
    expect(h.drive.imported).toHaveLength(0)
  })

  it('the Drive tab says which piece it wants', async () => {
    as(SCHEDULER)
    const { status, body } = await json(driveRoute.GET(new Request('https://x.test/drive')))
    expect(status).toBe(400)
    expect(body.error).toBe('Which piece?')
  })

  it('a Drive refusal is a sentence, and never a 500', async () => {
    as(SCHEDULER)
    h.drive.list = { ok: false, message: 'Google Drive needs reconnecting — ask an admin.' }
    const { status, body } = await json(driveRoute.GET(
      new Request(`https://x.test/drive?itemId=${ITEM}`)))
    expect(status).toBe(200)
    expect(body.error).toMatch(/reconnecting/)
    expect(body.files).toBeUndefined()
  })

  it('bringing files across returns slides and puts nothing in a post', async () => {
    as(SCHEDULER)
    const { status, body } = await json(driveRoute.POST(new Request('https://x.test/drive', {
      method: 'POST', body: JSON.stringify({ item_id: ITEM, file_ids: ['f1', 'f2'] }),
    })))
    expect(status).toBe(200)
    expect(body.files).toHaveLength(2)
    // Drive is a place files come FROM. Nothing here has made a version or
    // touched the item — that is `/media`'s job, and it is the one that asks
    // the client.
    expect(versions()).toHaveLength(1)
    expect(item().status).toBe('approved_for_scheduling')
  })

  it('asks for a file before it goes looking for one', async () => {
    as(SCHEDULER)
    const { status, body } = await json(driveRoute.POST(new Request('https://x.test/drive', {
      method: 'POST', body: JSON.stringify({ item_id: ITEM, file_ids: [] }),
    })))
    expect(status).toBe(400)
    expect(body.error).toBe('Pick a file first')
    expect(h.drive.imported).toHaveLength(0)
  })
})

/* ── the library function, direct ───────────────────────────────────────── */

describe('addMediaVersion, called directly', () => {
  it('refuses media that does not suit the piece', async () => {
    // a carousel with one card is a photo post wearing a carousel's caption
    await expect(lib.addMediaVersion(SCHEDULER as never, {
      item_id: ITEM, files: [NEW_FILE],
    })).rejects.toThrow()
    expect(versions()).toHaveLength(1)
  })

  /**
   * The picker uploads the moment a file is chosen and only THEN asks for a
   * version of it, so a refusal here leaves bytes in the bucket nothing points
   * at. The same tidy-up the crop endpoint does — and with the same care about
   * what it is allowed to delete, because the URLs are written by the caller.
   */
  describe('the upload that was refused', () => {
    const KEY = (n: string) => `https://media.mdmmarketing.com.au/1756000000000-a1b2c3-${n}`
    const uploaded = (n: string, type: 'image' | 'video' = 'image') =>
      ({ url: KEY(n), name: n, type })

    it('is thrown away when the save it was for does not happen', async () => {
      // a carousel of one is refused, and the file it named is nobody's
      await expect(lib.addMediaVersion(SCHEDULER as never, {
        item_id: ITEM, files: [uploaded('three.jpg')],
      })).rejects.toThrow()
      expect(h.deleted).toEqual([KEY('three.jpg')])
      expect(versions()).toHaveLength(1)
    })

    it('is left alone when the piece already holds it', async () => {
      // one card is not a carousel, so this is refused — with a file the
      // client already approved named in it. The tidy-up must not touch it.
      await expect(lib.addMediaVersion(SCHEDULER as never, {
        item_id: ITEM, files: [APPROVED[0]],
      })).rejects.toThrow()
      expect(h.deleted).toEqual([])
      expect(versions()).toHaveLength(1)
    })

    it('deletes nothing at all when the REQUEST is what was refused', async () => {
      as(STRANGER)
      await expect(lib.addMediaVersion(STRANGER as never, {
        item_id: ITEM, files: [uploaded('three.jpg'), uploaded('four.jpg')],
      })).rejects.toThrow()
      as(CLIENT_USER)
      await expect(lib.addMediaVersion(CLIENT_USER as never, {
        item_id: ITEM, files: [uploaded('three.jpg')],
      })).rejects.toThrow()
      expect(h.deleted).toEqual([])
    })

    it('never deletes a file that is not on our own storage', async () => {
      await expect(lib.addMediaVersion(SCHEDULER as never, {
        item_id: ITEM,
        files: [{ url: 'https://somebody-else.example/photo.jpg', name: 'p.jpg', type: 'image' }],
      })).rejects.toThrow()
      expect(h.deleted).toEqual([])
    })
  })

  it('leaves a piece that is not approved-and-scheduled where it is', async () => {
    fake.restore()
    fake = seed({ status: 'client_review' })
    // as the manager: a scheduler is not shown a piece that is still with the
    // client at all, which is its own (correct) refusal
    as(AM)
    const out = await lib.addMediaVersion(AM as never, {
      item_id: ITEM, files: [...APPROVED, NEW_FILE],
    })
    expect(out.created).toBe(true)
    // no edge out of client_review to client_review; the piece is already
    // with them, so there is nothing to move
    expect(item().status).toBe('client_review')
  })
})

/* ── the extras actually leave the building ─────────────────────────────── */

describe('what More options collects reaches the provider', () => {
  it('keeps the first comment, the collaborators, the Reel setting and the place', async () => {
    const { status, body } = await json(scheduleRoute.POST(
      new Request('https://x.test/api/social/schedule', {
        method: 'POST',
        body: JSON.stringify({
          item_id: ITEM, slides: APPROVED, caption: 'Hello everyone',
          channels: ['acc-1'],
          scheduled_for: new Date(Date.now() + 2 * 86_400_000).toISOString(),
          per_channel: {
            'acc-1': {
              kind: 'carousel',
              firstComment: '#brunch #fitzroy',
              collaborators: ['@chef', 'venue'],
              shareToFeed: true,
              locationId: '102938475610293',
            },
          },
        }),
      })))
    expect(status).toBe(200)
    // stored, not quietly dropped: everything the window collects used to be
    // thrown away on the way in, which made every one of those controls a
    // thing that did nothing
    expect(body.post.per_channel['acc-1']).toEqual({
      kind: 'carousel',
      firstComment: '#brunch #fitzroy',
      collaborators: ['chef', 'venue'],
      shareToFeed: true,
      locationId: '102938475610293',
    })
  })

  it('drops a place NAME typed into the id box rather than storing it', async () => {
    const { body } = await json(scheduleRoute.POST(
      new Request('https://x.test/api/social/schedule', {
        method: 'POST',
        body: JSON.stringify({
          item_id: ITEM, slides: APPROVED, caption: 'Hello everyone',
          channels: ['acc-1'],
          scheduled_for: new Date(Date.now() + 2 * 86_400_000).toISOString(),
          per_channel: { 'acc-1': { locationId: 'Sui Kitchen Fitzroy' } },
        }),
      })))
    expect(body.post.per_channel['acc-1'].locationId).toBeUndefined()
  })
})
