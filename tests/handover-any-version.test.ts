import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'

/**
 * THE HAND-OVER SENDS THE FILES, AND A POST MAY USE ANY VERSION (the owner, 30 Sep 2026: "make sure the handover
 * feature sends files to the scheduling page, and they can use from any version").
 *
 * The REAL hand-off route on the in-memory database: the fresh draft post it makes carries the card's approved
 * files — a file handed in from Drive with its Drive id — so the scheduler finds them on the post without picking.
 * Then the REAL updatePost: a file from an earlier version of the same card is accepted; another card's file and an
 * outside link are refused as before.
 */
const ITEM = 'aaaaaaaa-0000-4000-8000-00000000e001'
const OTHER_ITEM = 'aaaaaaaa-0000-4000-8000-00000000e002'
const AM = { id: 'u-am', role: 'account_manager', email: 'am@x.invalid', name: 'Ada', clerk_user_id: null }
const ED = { id: 'u-ed', role: 'editor', email: 'ed@x.invalid', name: 'Sam', clerk_user_id: null }
const SCHED = { id: 'u-sc', role: 'scheduler', email: 'sc@x.invalid', name: 'Cath', clerk_user_id: null }

const h = vi.hoisted(() => ({ user: null as unknown as Record<string, unknown> }))

vi.mock('../app/lib/authz', () => ({
  requireSignedIn: async () => h.user,
  requireRole: async () => h.user,
  AuthzError: class AuthzError extends Error {
    status: number
    constructor(message: string, status: number) { super(message); this.status = status }
  },
  authzErrorResponse: (e: unknown) => ({ error: e instanceof Error ? e.message : 'error', status: (e as { status?: number })?.status ?? 500 }),
}))
vi.mock('../app/lib/production-access', async orig => {
  const real = await orig() as Record<string, unknown>
  return {
    ...real,
    loadItemForUser: async (_u: unknown, id: string) => {
      const { table } = await import('@/lib/db')
      const row = await table('content_items').get(id)
      if (!row) throw Object.assign(new Error('Item not found'), { status: 404 })
      return row
    },
    accessibleClientIds: async () => null,
  }
})
vi.mock('../app/lib/mailer', () => ({
  notify: vi.fn(async () => 'sent'),
  renderEmail: (_s: string, body: string) => body,
  escapeHtml: (s: string) => s,
}))
vi.mock('../app/lib/gdrive-mirror', () => ({ mirrorLatestVersionSoon: vi.fn(), mirrorVersionSlides: vi.fn(), mirrorRawAssets: vi.fn(), newRawAssets: () => [] }))
vi.mock('../app/lib/stream', () => ({ previewVideos: vi.fn() }))
vi.mock('../app/lib/production-live', () => ({ announceItemChange: vi.fn(), announceBatchChange: vi.fn() }))
vi.mock('../lib/live', () => ({ announce: vi.fn(), announceAfter: vi.fn() }))
vi.mock('../app/inngest/client', () => ({ inngest: { send: vi.fn(async () => ({})) } }))
vi.mock('../app/lib/encode-ahead', () => ({ askForCopiesAhead: vi.fn() }))

const { POST } = await import('../app/api/production/items/[id]/handoff/route')
const { updatePost } = await import('../app/lib/social-schedule')
const { cardVersionGroups, anyVersionSlides, approvedFilesVersion } = await import('../app/lib/social-schedule-core')

// a files card at Version 2: Script 1 replaced in Version 2 from Drive, Script 2 carried from Version 1
const V1_S1 = { id: 'f_s1', name: 'Script 1.mp4', url: 'https://r2.test/up/s1.mp4', mime: 'video/mp4', size: 900, version: 1, uploaded_at: '2026-09-20T00:00:00.000Z', by: 'u-ed' }
const V1_S2 = { id: 'f_s2', name: 'Script 2.mp4', url: 'https://r2.test/up/s2.mp4', mime: 'video/mp4', size: 800, version: 1, uploaded_at: '2026-09-20T00:00:01.000Z', by: 'u-ed' }
const V2_S1 = { id: 'f_s1v2', asset_id: 'f_s1', replaces: 'f_s1', name: 'Script 1.mp4', url: 'https://r2.test/pulls/drv/s1-v2.mp4', mime: 'video/mp4', size: 950, version: 2, uploaded_at: '2026-09-28T00:00:00.000Z', by: 'u-ed', source: 'drive', drive_file_id: 'driveClip00001', drive_modified: '2026-09-28T00:00:00.000Z' }
const OTHER_FILE = { id: 'f_x', name: 'Elsewhere.mp4', url: 'https://r2.test/up/elsewhere.mp4', mime: 'video/mp4', size: 1, version: 1, uploaded_at: '2026-09-20T00:00:00.000Z', by: 'u-ed' }

let fake: ReturnType<typeof seedDb>
const seed = (status: string) => seedDb({
  clients: [{ id: 'c1', name: 'Park Noire', timezone: 'Australia/Melbourne', posts_own_content: false }] as unknown as Row[],
  team_users: [AM, ED, SCHED].map(u => ({ ...u, active_status: true })) as unknown as Row[],
  team_user_clients: [{ id: 'l1', team_user_id: AM.id, client_id: 'c1' }] as unknown as Row[],
  content_items: [
    {
      id: ITEM, client_id: 'c1', title: 'First Shoot', status, content_type: 'carousel',
      owner_id: ED.id, scheduler_ids: [], current_version_number: 2, edit_round: 2, client_round: 2, client_rounds: [1, 2],
      batch_id: null, work_kind_id: null, client_approval_required: true, due_date: null,
      final_files: [V1_S1, V1_S2, V2_S1],
    },
    {
      id: OTHER_ITEM, client_id: 'c1', title: 'Another card', status: 'approved_for_scheduling', content_type: 'reel',
      owner_id: ED.id, scheduler_ids: [], current_version_number: 1, final_files: [OTHER_FILE],
    },
  ] as unknown as Row[],
  asset_versions: [],
  workflow_activity: [],
} as never)

const hand = async () => {
  const res = await POST(
    new Request(`https://x.test/api/production/items/${ITEM}/handoff`, { method: 'POST', body: JSON.stringify({ scheduler_ids: [SCHED.id] }) }),
    { params: Promise.resolve({ id: ITEM }) },
  )
  return { status: res.status, json: await res.json() as { post_id?: string | null; post_problem?: string; error?: string } }
}
const postRow = () => fake.rows('social_posts')[0] as Record<string, any>

beforeEach(() => { h.user = AM })
afterEach(() => fake.restore())

describe('the hand-over makes the scheduler’s post WITH the card’s files', () => {
  it('the fresh draft post carries the approved version’s files — the Drive one with its Drive id', async () => {
    fake = seed('approved_for_scheduling')
    const r = await hand()
    expect(r.status).toBe(200)
    expect(r.json.post_problem).toBeUndefined()
    expect(r.json.post_id).toBeTruthy()
    const slides = postRow().slides as Record<string, unknown>[]
    expect(slides.map(s => s.url)).toEqual([V2_S1.url, V1_S2.url])
    expect(slides[0]).toMatchObject({ source: 'drive', drive_file_id: 'driveClip00001' })
    expect(slides[1]).not.toHaveProperty('drive_file_id')
    expect(postRow().assigned_to).toBe(SCHED.id)
  })
})

describe('a post of this card may use any of its versions', () => {
  it('the picker’s groups: Version 2 (latest) as the card stands, Version 1 as it stood', () => {
    const card = { status: 'approved_for_scheduling', edit_round: 2, final_files: [V1_S1, V1_S2, V2_S1] }
    const groups = cardVersionGroups(card as never, [])
    expect(groups.map(g => g.label)).toEqual(['Version 2 (latest)', 'Version 1'])
    expect(groups[0].slides.map(s => s.url)).toEqual([V2_S1.url, V1_S2.url])
    expect(groups[1].slides.map(s => s.url)).toEqual([V1_S1.url, V1_S2.url])
    expect(anyVersionSlides(card as never, []).map(s => s.url)).toEqual([V2_S1.url, V1_S2.url, V1_S1.url])
    // the approved files are unchanged — still the latest version only
    expect((approvedFilesVersion(card as never)!.files as { url: string }[]).map(s => s.url)).toEqual([V2_S1.url, V1_S2.url])
  })

  it('a card of older media versions groups them by version number', () => {
    const groups = cardVersionGroups({ status: 'approved_for_scheduling' } as never, [
      { version_number: 1, file_url: 'https://r2.test/a.jpg' }, { version_number: 3, file_url: 'https://r2.test/c.jpg' },
    ] as never)
    expect(groups.map(g => [g.label, g.slides[0].url])).toEqual([['Version 3 (latest)', 'https://r2.test/c.jpg'], ['Version 1', 'https://r2.test/a.jpg']])
  })

  it('updatePost takes Version 1’s cut of Script 1; refuses another card’s file and an outside link', async () => {
    fake = seed('approved_for_scheduling')
    const r = await hand()
    const id = String(r.json.post_id)
    h.user = SCHED
    const saved = await updatePost(SCHED as never, id, { slides: [{ url: V1_S1.url }, { url: V1_S2.url }] } as never)
    expect(saved.slides.map(s => s.url)).toEqual([V1_S1.url, V1_S2.url])
    await expect(updatePost(SCHED as never, id, { slides: [{ url: OTHER_FILE.url }] } as never)).rejects.toThrow(/not part of the approved version/)
    await expect(updatePost(SCHED as never, id, { slides: [{ url: 'https://example.com/x.mp4' }] } as never)).rejects.toThrow(/not part of the approved version/)
  })
})
