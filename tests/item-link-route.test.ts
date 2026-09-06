import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'

/**
 * A CARD CARRIES A LINK. Setting it, replacing it (a new version, with the
 * History line that keeps the approval trail readable), and who may.
 * Against the real `@/lib/db`: the version bump is a conditional write and
 * that is what is being tested.
 */

const ITEM = 'aaaaaaaa-0000-4000-8000-000000000001'
const OWNER = { id: 'u-ed', role: 'editor', email: 'ed@x.invalid', name: 'Eden', clerk_user_id: null }
const OTHER = { id: 'u-other', role: 'editor', email: 'o@x.invalid', name: 'Omar', clerk_user_id: null }
const AM = { id: 'u-am', role: 'account_manager', email: 'am@x.invalid', name: 'Ada', clerk_user_id: null }

const h = vi.hoisted(() => ({ user: null as unknown as Record<string, unknown>, activity: [] as Record<string, unknown>[] }))

vi.mock('../app/lib/authz', () => ({
  requireRole: async () => h.user,
  requireSignedIn: async () => h.user,
  AuthzError: class AuthzError extends Error {
    status: number
    constructor(message: string, status: number) { super(message); this.status = status }
  },
  authzErrorResponse: (e: unknown) => ({
    error: e instanceof Error ? e.message : 'error',
    status: (e as { status?: number })?.status ?? 500,
  }),
}))
vi.mock('../app/lib/production-access', () => ({
  loadItemForUser: async (_u: unknown, id: string) => {
    const { table } = await import('@/lib/db')
    return table('content_items').get(id)
  },
}))
vi.mock('../app/lib/workflow', () => ({
  logActivity: vi.fn(async (a: Record<string, unknown>) => { h.activity.push(a) }),
}))
vi.mock('../app/lib/production-live', () => ({ announceItemChange: vi.fn() }))

const { PUT, DELETE } = await import('../app/api/production/items/[id]/link/route')

const put = async (url: unknown) => {
  const res = await PUT(
    new Request(`https://x.test/api/production/items/${ITEM}/link`, { method: 'PUT', body: JSON.stringify({ url }) }),
    { params: Promise.resolve({ id: ITEM }) },
  )
  return { status: res.status, json: await res.json() as any }
}

const DRIVE_1 = 'https://drive.google.com/file/d/1/view'
const DRIVE_2 = 'https://drive.google.com/file/d/2/view'
const DROPBOX = 'https://www.dropbox.com/s/abc/reel.mp4'

let fake: ReturnType<typeof seedDb>
const item = () => fake.rows('content_items')[0] as Record<string, unknown>

beforeEach(() => {
  h.user = OWNER
  h.activity = []
  fake = seedDb({
    content_items: [{
      id: ITEM, client_id: 'c1', title: 'Winter reel', status: 'draft_uploaded',
      owner_id: OWNER.id, scheduler_ids: [], current_version_number: 0,
    }] as unknown as Row[],
  })
})
afterEach(() => fake.restore())

describe('PUT /api/production/items/[id]/link', () => {
  it('sets a first link as version 1, labelled by where it lives', async () => {
    const r = await put(DRIVE_1)
    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({ ok: true, version: 1, kind: 'drive', label: 'Google Drive' })
    expect(item()).toMatchObject({ link_url: DRIVE_1, link_kind: 'drive', current_version_number: 1 })
    expect(h.activity[0]).toMatchObject({ action: 'link_added', newValue: 'v1' })
  })

  it('replacing the link bumps the version and writes "Link updated to version N"', async () => {
    await put(DRIVE_1)
    const r = await put(DROPBOX)
    expect(r.json).toMatchObject({ ok: true, version: 2, kind: 'dropbox' })
    expect(item()).toMatchObject({ link_url: DROPBOX, link_kind: 'dropbox', current_version_number: 2 })
    expect(h.activity[1]).toMatchObject({
      action: 'link_updated', newValue: 'v2', detail: 'Link updated to version 2',
    })
    const again = await put(DRIVE_2)
    expect(again.json.version).toBe(3)
    expect(h.activity[2].detail).toBe('Link updated to version 3')
  })

  it('pasting the same link again is not a new version', async () => {
    await put(DRIVE_1)
    const r = await put(DRIVE_1)
    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({ ok: true, already: true, version: 1 })
    expect(item().current_version_number).toBe(1)
    expect(h.activity).toHaveLength(1)
  })

  it('a first link on a card with uploaded versions keeps its number', async () => {
    fake.tree().mdm.tables.content_items[ITEM].current_version_number = 3
    const r = await put(DRIVE_1)
    expect(r.json.version).toBe(3)
  })

  it('refuses a non-https link in plain words, touching nothing', async () => {
    const r = await put('http://drive.google.com/file/d/1/view')
    expect(r.status).toBe(400)
    expect(r.json.error).toBe('Links must start with https://')
    expect(item().link_url).toBeUndefined()
    expect(item().current_version_number).toBe(0)
  })

  it('the person holding the card and a manager may set it; another editor may not', async () => {
    h.user = OTHER
    const refused = await put(DRIVE_1)
    expect(refused.status).toBe(403)
    expect(refused.json.error).toBe('Only whoever holds this card — or a manager — can change its link')
    h.user = AM
    expect((await put(DRIVE_1)).status).toBe(200)
  })

  it('two people pasting at once get two versions, never the same one', async () => {
    await put(DRIVE_1)
    // a rival's replacement lands between this request's read and its write
    const off = fake.onBeforeWrite(`/mdm/tables/content_items/${ITEM}`, () => {
      off()
      const row = fake.tree().mdm.tables.content_items[ITEM]
      row.link_url = DROPBOX
      row.current_version_number = 2
    })
    const r = await put(DRIVE_2)
    expect(r.status).toBe(200)
    // claim() re-decided on the rival's row: theirs was v2, so this is v3
    expect(r.json.version).toBe(3)
    expect(item()).toMatchObject({ link_url: DRIVE_2, current_version_number: 3 })
  })

  it('DELETE clears the link and keeps the version number', async () => {
    await put(DRIVE_1)
    const res = await DELETE(new Request('https://x.test'), { params: Promise.resolve({ id: ITEM }) })
    expect(res.status).toBe(200)
    expect(item().link_url).toBeUndefined()
    expect(item().link_kind).toBeUndefined()
    expect(item().current_version_number).toBe(1)
    expect(h.activity.at(-1)).toMatchObject({ action: 'link_removed' })
  })
})
