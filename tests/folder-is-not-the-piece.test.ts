import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'

/**
 * THE FOLDER TO WORK FROM IS NOT THE FINISHED PIECE (the owner, 13 Sep 2026)
 * — ON A POSTING JOB.
 *
 * An account manager makes a New post with a Drive folder and hands it to a
 * scheduler, who "uploads the files and chooses which one to schedule". Until
 * they do, "Ready for quality check" has nothing for the quality checker —
 * the card's only link is the folder it was made with.
 *
 * THE EDITOR'S CARD IS THE OTHER WAY ROUND (the owner, 14 Sep 2026: "editors
 * don't need to upload files — it's the link only"): the pasted Drive or
 * Dropbox link IS the finished edit, even when it is the same folder the
 * card was made with. Drives the REAL transition route on the in-memory
 * database.
 */

const ITEM = 'aaaaaaaa-0000-4000-8000-000000000009'
const FOLDER = 'https://drive.google.com/drive/folders/1abc'
const SUPER = { id: 'u-sa', role: 'super_admin', email: 'sa@x.invalid', name: 'Akmal', clerk_user_id: null }
const CATH = { id: 'u-cath', role: 'scheduler', email: 'cath@x.invalid', name: 'Cath', clerk_user_id: null }

const h = vi.hoisted(() => ({ user: null as unknown as Record<string, unknown> }))

vi.mock('../app/lib/authz', () => ({
  requireSignedIn: async () => h.user,
  requireRole: async () => h.user,
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
    const row = await table('content_items').get(id)
    if (!row) throw Object.assign(new Error('Item not found'), { status: 404 })
    return row
  },
}))
vi.mock('../app/lib/mailer', () => ({
  notify: vi.fn(async () => 'sent'),
  renderEmail: (_s: string, body: string) => body,
  escapeHtml: (s: string) => s,
}))
vi.mock('../app/lib/gdrive-mirror', () => ({
  mirrorLatestVersionSoon: vi.fn(), mirrorVersionSlides: vi.fn(),
  mirrorRawAssets: vi.fn(), newRawAssets: () => [],
}))
vi.mock('../app/lib/stream', () => ({ previewVideos: vi.fn() }))
vi.mock('../app/lib/production-live', () => ({ announceItemChange: vi.fn(), announceBatchChange: vi.fn() }))
vi.mock('../lib/live', () => ({ announce: vi.fn(), announceAfter: vi.fn() }))
vi.mock('../app/inngest/client', () => ({ inngest: { send: vi.fn(async () => ({})) } }))

const { POST } = await import('../app/api/production/items/[id]/transition/route')

const move = async (to: string) => {
  const res = await POST(
    new Request(`https://x.test/api/production/items/${ITEM}/transition`, { method: 'POST', body: JSON.stringify({ to }) }),
    { params: Promise.resolve({ id: ITEM }) },
  )
  return { status: res.status, json: await res.json() as { status?: string; error?: string } }
}

let fake: ReturnType<typeof seedDb>
const seed = (over: { item?: Record<string, unknown>; versions?: Row[]; activity?: Row[] } = {}) => seedDb({
  clients: [{ id: 'c1', name: 'Park Noire', timezone: 'Australia/Melbourne', posts_own_content: false }] as unknown as Row[],
  team_users: [SUPER, CATH].map(u => ({ ...u, active_status: true })) as unknown as Row[],
  team_user_clients: [] as Row[],
  content_items: [{
    id: ITEM, client_id: 'c1', title: 'Spring reel 2', status: 'draft_uploaded', content_type: 'other',
    owner_id: CATH.id, scheduler_ids: [], current_version_number: 1, batch_id: null,
    work_kind_id: null, client_approval_required: true, due_date: null,
    // the New post window writes the folder to BOTH fields, and flags the
    // card as a posting job
    link_url: FOLDER, link_kind: 'drive', raw_assets_url: FOLDER, adhoc_post: true,
    ...over.item,
  }] as unknown as Row[],
  asset_versions: over.versions ?? [],
  workflow_activity: over.activity ?? [],
} as never)

beforeEach(() => { h.user = SUPER })
afterEach(() => fake.restore())

describe('Ready for quality check on a card made with a folder to work from', () => {
  it('is refused while the folder is the card’s only link — there is nothing to check yet', async () => {
    fake = seed()
    const r = await move('quality_check')
    expect(r.status).toBe(400)
    expect(r.json.error).toBe('Upload the finished files first — the folder is what you work from, not the piece to check')
  })

  it('goes through once the finished files are uploaded as a version', async () => {
    fake = seed({ versions: [{
      id: 'v1', item_id: ITEM, version_number: 1,
      files: [{ url: 'https://r2/reel.mp4', name: 'reel.mp4', type: 'video' }], file_url: 'https://r2/reel.mp4',
    }] as unknown as Row[] })
    const r = await move('quality_check')
    expect(r.status).toBe(200)
    expect(r.json.status).toBe('quality_check')
  })

  it('a card whose link IS the finished piece (not its working folder) still goes through on the link alone', async () => {
    fake = seed({ item: { link_url: 'https://www.dropbox.com/scl/fo/final-reel', link_kind: 'dropbox', raw_assets_url: FOLDER } })
    const r = await move('quality_check')
    expect(r.status).toBe(200)
  })
})

describe('Submit for quality check on an editor’s card (not a posting job)', () => {
  beforeEach(() => { h.user = { ...CATH, role: 'editor' } })

  it('goes through on the pasted link alone — no files needed (the owner, 14 Sep 2026)', async () => {
    fake = seed({ item: { adhoc_post: null, link_url: 'https://drive.google.com/drive/folders/1final', link_kind: 'drive', raw_assets_url: null } })
    const r = await move('quality_check')
    expect(r.status).toBe(200)
    expect(r.json.status).toBe('quality_check')
  })

  it('is refused while the only link is the folder the card was made with — that is the files to work from, not a finished edit (the owner, 16 Sep 2026)', async () => {
    fake = seed({ item: { adhoc_post: null } })
    const r = await move('quality_check')
    expect(r.status).toBe(400)
  })

  it('after a revision was asked for, the same link goes back for the quality check (the owner, 14 Sep 2026)', async () => {
    // the editor fixed the files behind the same Drive link: there is no new
    // uploaded version to demand
    fake = seed({
      item: { adhoc_post: null, status: 'revision_required', link_url: 'https://drive.google.com/drive/folders/1final', link_kind: 'drive', raw_assets_url: null },
      activity: [{ id: 'a1', entity_type: 'content_item', entity_id: ITEM, action: 'status_change', new_value: 'revision_required', created_at: new Date().toISOString(), actor_id: SUPER.id }] as unknown as Row[],
    })
    const r = await move('quality_check')
    expect(r.status).toBe(200)
    expect(r.json.status).toBe('quality_check')
  })

  it('a card with uploaded files still needs a newer version after a revision was asked for', async () => {
    const asked = new Date().toISOString()
    fake = seed({
      item: { adhoc_post: null, status: 'revision_required', link_url: null, link_kind: null, raw_assets_url: null },
      versions: [{ id: 'v1', item_id: ITEM, version_number: 1, created_at: '2026-09-01T00:00:00.000Z', files: [{ url: 'https://r2/reel.mp4', name: 'reel.mp4', type: 'video' }], file_url: 'https://r2/reel.mp4' }] as unknown as Row[],
      activity: [{ id: 'a1', entity_type: 'content_item', entity_id: ITEM, action: 'status_change', new_value: 'revision_required', created_at: asked, actor_id: SUPER.id }] as unknown as Row[],
    })
    const r = await move('quality_check')
    expect(r.status).toBe(400)
    expect(r.json.error).toBe('Add a new version with the revisions first.')
  })

  it('the card records who the move reached (the owner, 14 Sep 2026: "quality check did not notify — check what happened")', async () => {
    fake = seed({ item: { adhoc_post: null, link_url: 'https://drive.google.com/drive/folders/1final', link_kind: 'drive', raw_assets_url: null } })
    const r = await move('quality_check')
    expect(r.status).toBe(200)
    // the fan-out runs after the response; give it a tick
    await new Promise(res => setTimeout(res, 50))
    const told = (fake.rows('workflow_activity') as unknown as { action: string; entity_id: string; detail?: string }[])
      .filter(a => a.action === 'notified' && a.entity_id === ITEM)
    expect(told).toHaveLength(1)
    // nobody wears the quality hat here, so the super admin stood in and was told
    expect(told[0].detail).toBe('Told: Akmal (sent)')
  })

  it('a card with neither a link nor files says to paste the link, not to upload', async () => {
    fake = seed({ item: { adhoc_post: null, link_url: null, link_kind: null, raw_assets_url: null } })
    const r = await move('quality_check')
    expect(r.status).toBe(400)
    expect(r.json.error).toBe('Paste the link to the finished edit before submitting')
  })
})
