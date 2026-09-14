import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * THE HAND-OVER FROM EDITING TO POSTING (the owner, 14 Sep 2026: "ensure on
 * the Editor page the AM or super admin can hand over to a scheduler, who
 * then picks files from their link and uploads the files instead for the
 * approval").
 *
 * Drives the REAL hand-off route on the in-memory database, then reads the
 * scheduler's side with the same pure rules the pages use: the card is on
 * their board, the editor's finished edit is the link they pick from, the
 * folder is still the folder, and the email lands on Post approval.
 */
const ITEM = 'aaaaaaaa-0000-4000-8000-000000000021'
const FOLDER = 'https://drive.google.com/drive/folders/1work'
const EDIT = 'https://drive.google.com/drive/folders/1finals'
const AM = { id: 'u-am', role: 'account_manager', email: 'am@x.invalid', name: 'Ada', clerk_user_id: null }
const SUPER = { id: 'u-sa', role: 'super_admin', email: 'sa@x.invalid', name: 'Akmal', clerk_user_id: null }
const ED = { id: 'u-ed', role: 'editor', email: 'ed@x.invalid', name: 'Sam', clerk_user_id: null }
const SCHED = { id: 'u-sc', role: 'scheduler', email: 'sc@x.invalid', name: 'Cath', clerk_user_id: null }
const SCHED2 = { id: 'u-sc2', role: 'scheduler', email: 'sc2@x.invalid', name: 'Kim', clerk_user_id: null }

const h = vi.hoisted(() => ({
  user: null as unknown as Record<string, unknown>,
  emails: [] as { recipientEmail: string; subject: string; bodyHtml: string }[],
}))

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
  notify: vi.fn(async (input: { recipientEmail: string; subject: string; bodyHtml: string }) => { h.emails.push(input); return 'sent' }),
  renderEmail: (_s: string, body: string, _cta?: string, href?: string) => `${body} ${href ?? ''}`,
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

const { POST } = await import('../app/api/production/items/[id]/handoff/route')
const { visibleItems } = await import('../app/lib/scope-client')
const { finishedEditOf, folderOf } = await import('../app/lib/card-link-core')
const { needsWorkFirst } = await import('../app/lib/board-view-core')
const { itemPath } = await import('../app/lib/workflow-core')

const hand = async (schedulerIds: string[]) => {
  const res = await POST(
    new Request(`https://x.test/api/production/items/${ITEM}/handoff`, { method: 'POST', body: JSON.stringify({ scheduler_ids: schedulerIds }) }),
    { params: Promise.resolve({ id: ITEM }) },
  )
  return { status: res.status, json: await res.json() as { notified?: number; error?: string } }
}

let fake: ReturnType<typeof seedDb>
const card = () => fake.rows('content_items').find(r => r.id === ITEM) as Record<string, unknown>
const seed = (status = 'approved_for_scheduling') => seedDb({
  clients: [{ id: 'c1', name: 'Park Noire', timezone: 'Australia/Melbourne', posts_own_content: false }] as unknown as Row[],
  team_users: [AM, SUPER, ED, SCHED, SCHED2].map(u => ({ ...u, active_status: true })) as unknown as Row[],
  team_user_clients: [{ id: 'l1', team_user_id: AM.id, client_id: 'c1' }] as unknown as Row[],
  content_items: [{
    id: ITEM, client_id: 'c1', title: 'Spring reel', status, content_type: 'reel',
    owner_id: ED.id, scheduler_ids: [], current_version_number: 1, batch_id: null,
    work_kind_id: null, client_approval_required: true, due_date: null,
    // the folder the manager gave, and the finished edit the editor handed in
    raw_assets_url: FOLDER, link_url: EDIT, link_kind: 'drive', link_final: true,
  }] as unknown as Row[],
  asset_versions: [],
  workflow_activity: [],
} as never)

beforeEach(() => { h.user = AM; h.emails = [] })
afterEach(() => fake.restore())

describe('a manager hands an approved edit to a scheduler', () => {
  it('the account manager hands it to one scheduler; only that scheduler sees it, on Post approval, with the edit to pick from', async () => {
    fake = seed()
    const r = await hand([SCHED.id])
    expect(r.status).toBe(200)
    expect(card().scheduler_ids).toEqual([SCHED.id])

    // told once, with the card open on the scheduler's own board
    const toCath = h.emails.filter(e => e.recipientEmail === SCHED.email)
    expect(toCath).toHaveLength(1)
    expect(toCath[0].bodyHtml).toContain(`/dashboard/scheduler?card=${ITEM}`)
    expect(toCath[0].bodyHtml).not.toContain('/dashboard/production/')
    expect(itemPath(card() as never, 'scheduler')).toBe(`/dashboard/scheduler?card=${ITEM}`)

    // on Cath's board, not Kim's
    const items = [card()] as never[]
    const sees = (id: string) => visibleItems({ id, role: 'scheduler', client_id: null } as never, items, [], { schedulerPostFilter: true } as never).length
    expect(sees(SCHED.id)).toBe(1)
    expect(sees(SCHED2.id)).toBe(0)

    // what Cath opens: the editor's finished edit to pick the files from,
    // the working folder still the folder, nothing asking her to upload
    // before she can act
    expect(finishedEditOf(card() as never)).toEqual({ url: EDIT, label: 'Google Drive' })
    expect(folderOf(card() as never)).toEqual({ url: FOLDER, kind: 'drive' })
    expect(needsWorkFirst(card() as never)).toBe(false)
  })

  it('a super admin may hand it on too; an editor may not; a card still in the quality check cannot be handed', async () => {
    fake = seed()
    h.user = SUPER
    expect((await hand([SCHED.id])).status).toBe(200)
    h.user = ED
    expect((await hand([SCHED.id])).status).toBe(403)
    fake.restore()
    fake = seed('quality_check')
    h.user = AM
    const r = await hand([SCHED.id])
    expect(r.status).toBe(400)
    expect(r.json.error).toBe('Only an approved or scheduled item can be handed to someone')
  })

  it('the pickers offer scheduler users: Hand to on a card, and Hand to on a New post', () => {
    const s = readFileSync(join(process.cwd(), 'app/dashboard/board/BoardDialogs.tsx'), 'utf8')
    expect(s).toContain(".filter(u => u.active_status !== false && u.role === 'scheduler')")
    expect(s).toContain("const handTo = forPosting ? team.filter(p => p.role === 'scheduler') : team")
    // the scheduler's drawer: the finished edit above the folder, and files
    // added on top of it for the approval
    const d = readFileSync(join(process.cwd(), 'app/dashboard/board/PostApprovalDetail.tsx'), 'utf8')
    expect(d).toContain('Open the finished edit · {finished.label}')
    expect(d).toMatch(/finished \? 'Add files' : 'Add the finished files'/)
  })
})
