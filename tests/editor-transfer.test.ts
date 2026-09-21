import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'
import {
  EDITING_ROLES, TRANSFER_STATUSES, canTransferEditing, editorRefusal, transferRefusal, transferWords,
} from '../app/lib/editor-transfer-core'

/**
 * TRANSFER THE EDITING JOB (the owner, 15 Sep 2026: "when a card has been
 * created and the footage is in, an AM for that client or a super admin
 * should be able to transfer the editing job — move all the editing data
 * to another editor").
 */
const ITEM = 'aaaaaaaa-0000-4000-8000-000000000031'
const SHOOT = 'bbbbbbbb-0000-4000-8000-000000000031'
const AM = { id: 'u-am', role: 'account_manager', email: 'am@x.invalid', name: 'Ada', clerk_user_id: null }
const AM2 = { id: 'u-am2', role: 'account_manager', email: 'am2@x.invalid', name: 'Bea', clerk_user_id: null }
const SUPER = { id: 'u-sa', role: 'super_admin', email: 'sa@x.invalid', name: 'Akmal', clerk_user_id: null }
const ED = { id: 'u-ed', role: 'editor', email: 'ed@x.invalid', name: 'Sam', clerk_user_id: null }
const ED2 = { id: 'u-ed2', role: 'editor', email: 'ed2@x.invalid', name: 'Dani', clerk_user_id: null }
const SCHED = { id: 'u-sc', role: 'scheduler', email: 'sc@x.invalid', name: 'Cath', clerk_user_id: null }

describe('who may transfer, from which stage, to whom (pure)', () => {
  const card = { status: 'draft_uploaded', client_id: 'c1', owner_id: ED.id }
  it('the client’s account manager or a super admin, while the card is still being edited', () => {
    expect(canTransferEditing({ id: 'x', role: 'super_admin', clientIds: null }, card)).toBe(true)
    expect(canTransferEditing({ id: 'x', role: 'account_manager', clientIds: ['c1'] }, card)).toBe(true)
    expect(transferRefusal({ id: 'x', role: 'account_manager', clientIds: ['c2'] }, card)).toMatch(/account manager on this client/)
    expect(transferRefusal({ id: 'x', role: 'editor', clientIds: [] }, card)).toMatch(/account manager or a super admin/)
    expect(transferRefusal({ id: 'x', role: 'general', clientIds: null }, card)).toMatch(/account manager or a super admin/)
    for (const status of TRANSFER_STATUSES) expect(canTransferEditing({ id: 'x', role: 'super_admin' }, { ...card, status })).toBe(true)
    // AT ANY STAGE (21 Sep 2026): with the client, approved, scheduled, published — the card can always be moved
    for (const status of ['client_review', 'approved_for_scheduling', 'scheduled', 'published']) {
      expect(transferRefusal({ id: 'x', role: 'super_admin' }, { ...card, status })).toBeNull()
    }
    expect(transferRefusal({ id: 'x', role: 'super_admin' }, { ...card, adhoc_post: true })).toMatch(/hand it to a scheduler/)
  })
  it('the job goes to an editor or a manager who also cuts — never a scheduler, a client, or the person who has it', () => {
    expect(EDITING_ROLES).toEqual(['editor', 'account_manager', 'super_admin'])
    expect(editorRefusal({ id: 'a', role: 'editor', active_status: true }, ED.id)).toBeNull()
    expect(editorRefusal({ id: 'a', role: 'super_admin', active_status: true }, ED.id)).toBeNull()
    expect(editorRefusal({ id: 'a', role: 'scheduler', active_status: true }, ED.id)).toMatch(/editor, or a manager/)
    expect(editorRefusal({ id: 'a', role: 'editor', active_status: false }, ED.id)).toMatch(/current team member/)
    expect(editorRefusal(null, ED.id)).toMatch(/current team member/)
    expect(editorRefusal({ id: ED.id, role: 'editor', active_status: true }, ED.id)).toMatch(/already/)
  })
  it('the history says who it moved from and to', () => {
    expect(transferWords('Sam', 'Dani')).toBe('editing moved from Sam to Dani')
    expect(transferWords(null, 'Dani')).toBe('editing given to Dani')
  })
})

const h = vi.hoisted(() => ({
  user: null as unknown as Record<string, unknown>,
  clientIds: null as string[] | null,
  emails: [] as { recipientEmail: string; subject: string; bodyHtml: string }[],
}))
vi.mock('../app/lib/authz', () => ({
  requireSignedIn: async () => h.user,
  requireRole: async () => h.user,
  isQualityReviewer: () => false,
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
  accessibleClientIds: async () => h.clientIds,
}))
vi.mock('../app/lib/mailer', () => ({
  notify: vi.fn(async (input: { recipientEmail: string; subject: string; bodyHtml: string }) => { h.emails.push(input); return 'sent' }),
  renderEmail: (_s: string, body: string, _cta?: string, href?: string) => `${body} ${href ?? ''}`,
  escapeHtml: (s: string) => s,
}))
vi.mock('../app/lib/gdrive-mirror', () => ({
  mirrorLatestVersionSoon: vi.fn(), mirrorVersionSlides: vi.fn(), mirrorRawAssets: vi.fn(), newRawAssets: () => [],
}))
vi.mock('../app/lib/stream', () => ({ previewVideos: vi.fn() }))
vi.mock('../app/lib/production-live', () => ({ announceItemChange: vi.fn(), announceBatchChange: vi.fn() }))
vi.mock('../lib/live', () => ({ announce: vi.fn(), announceAfter: vi.fn() }))
vi.mock('../app/inngest/client', () => ({ inngest: { send: vi.fn(async () => ({})) } }))

const { POST } = await import('../app/api/production/items/[id]/transfer-editing/route')

const transfer = async (editorId: string, note?: string) => {
  const res = await POST(
    new Request(`https://x.test/api/production/items/${ITEM}/transfer-editing`, { method: 'POST', body: JSON.stringify({ editor_id: editorId, note }) }),
    { params: Promise.resolve({ id: ITEM }) },
  )
  return { status: res.status, json: await res.json() as { ok?: boolean; shoot_followed?: boolean; error?: string } }
}
const settle = () => new Promise(r => setTimeout(r, 30))

let fake: ReturnType<typeof seedDb>
const card = () => fake.rows('content_items').find(r => r.id === ITEM) as Record<string, unknown>
const shoot = () => fake.rows('batches').find(r => r.id === SHOOT) as Record<string, unknown>
const seed = (status = 'draft_uploaded', shootEditor: string | null = ED.id) => seedDb({
  clients: [{ id: 'c1', name: 'Park Noire', timezone: 'Australia/Melbourne' }] as unknown as Row[],
  team_users: [AM, AM2, SUPER, ED, ED2, SCHED].map(u => ({ ...u, active_status: true })) as unknown as Row[],
  team_user_clients: [{ id: 'l1', team_user_id: AM.id, client_id: 'c1' }] as unknown as Row[],
  batches: [{ id: SHOOT, client_id: 'c1', title: 'Spring shoot', status: 'locked', editor_id: shootEditor, owner_id: AM.id, crew_ids: [] }] as unknown as Row[],
  content_items: [{
    id: ITEM, client_id: 'c1', title: 'Spring reel', status, content_type: 'reel',
    owner_id: ED.id, scheduler_ids: [], current_version_number: 1, batch_id: SHOOT,
    work_kind_id: null, client_approval_required: true, due_date: null,
    brief: 'Cut the intro tight', raw_assets_url: 'https://drive.google.com/drive/folders/1footage',
    link_url: 'https://drive.google.com/drive/folders/1edit', link_kind: 'drive',
  }] as unknown as Row[],
  item_comments: [{ id: 'k1', item_id: ITEM, author_id: AM.id, body: 'first note', visibility: 'internal' }] as unknown as Row[],
  workflow_activity: [],
} as never)

beforeEach(() => { h.user = SUPER; h.clientIds = null; h.emails = [] })
afterEach(() => { fake?.restore(); fake = undefined as never })

describe('the route moves the card, the shoot’s editor follows, the new editor is told', () => {
  it('a super admin moves Sam’s edit to Dani: the card is Dani’s with everything still on it, the shoot names Dani, Dani hears once', async () => {
    fake = seed()
    const r = await transfer(ED2.id, 'Sam is away — pick up from script 3')
    expect(r.status).toBe(200)
    expect(r.json.shoot_followed).toBe(true)
    const c = card()
    expect(c.owner_id).toBe(ED2.id)
    expect(c.assigned_by).toBe(SUPER.id)
    expect(c.asked_ids).toEqual([ED2.id])
    // nothing on the card is lost
    expect(c.brief).toBe('Cut the intro tight')
    expect(c.raw_assets_url).toBe('https://drive.google.com/drive/folders/1footage')
    expect(c.link_url).toBe('https://drive.google.com/drive/folders/1edit')
    expect(c.status).toBe('draft_uploaded')
    expect(c.batch_id).toBe(SHOOT)
    expect(fake.rows('item_comments')).toHaveLength(1)
    // the shoot's editor follows
    expect(shoot().editor_id).toBe(ED2.id)
    // the new editor is told, with the words, once; nobody else
    await settle()
    // BOTH are told (21 Sep 2026): Dani that it is hers, Sam that it has left him
    expect(h.emails.map(e => e.recipientEmail).sort()).toEqual([ED2.email, ED.email].sort())
    const toDani = h.emails.find(e => e.recipientEmail === ED2.email)!
    expect(toDani.bodyHtml).toContain('Sam is away')
    expect(toDani.bodyHtml).toContain('Spring reel')
    const toSam = h.emails.find(e => e.recipientEmail === ED.email)!
    expect(toSam.subject).toContain('is no longer yours')
    expect(toSam.bodyHtml).toContain('Dani')
    // the history says so
    const rows = fake.rows('workflow_activity') as { action?: string; detail?: string }[]
    expect(rows.some(a => a.action === 'editing_transferred' && /moved from Sam to Dani/.test(String(a.detail)))).toBe(true)
  })
  it('the account manager on the client may; one on another client, an editor, a scheduler may not', async () => {
    fake = seed()
    h.user = AM; h.clientIds = ['c1']
    expect((await transfer(ED2.id)).status).toBe(200)
    fake.restore(); fake = seed()
    h.user = AM2; h.clientIds = ['c2']
    expect((await transfer(ED2.id)).status).toBe(400)
    expect(card().owner_id).toBe(ED.id)
    h.user = ED; h.clientIds = []
    expect((await transfer(ED2.id)).status).toBe(403)
    h.user = SCHED; h.clientIds = null
    expect((await transfer(ED2.id)).status).toBe(403)
    expect(card().owner_id).toBe(ED.id)
  })
  it('a scheduler as the target, or the same person again is refused and nothing moves', async () => {
    fake = seed()
    expect((await transfer(SCHED.id)).json.error).toMatch(/editor, or a manager/)
    expect((await transfer(ED.id)).json.error).toMatch(/already/)
    expect((await transfer('')).status).toBe(400)
    expect(card().owner_id).toBe(ED.id)
    expect(shoot().editor_id).toBe(ED.id)
    await settle()
    expect(h.emails).toHaveLength(0)
  })
  it('a shoot whose named editor is somebody else keeps its editor; a manager who also cuts may take the job', async () => {
    fake = seed('revision_required', AM.id)
    const r = await transfer(SUPER.id === h.user.id ? AM2.id : AM2.id)
    expect(r.status).toBe(200)
    expect(r.json.shoot_followed).toBe(false)
    expect(card().owner_id).toBe(AM2.id)
    expect(shoot().editor_id).toBe(AM.id)
  })
})

describe('the card page offers it (source pins)', () => {
  const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n')
  it('a manager sees "Transfer the editing job" on the card page, and the dialog posts to the route', () => {
    const page = src('app/dashboard/editor/[id]/page.tsx')
    expect(page).toContain("const transferable = canTransferEditing({ id: viewer.id, role: viewer.role, clientIds: null }, item as never)")
    expect(page).toContain('Transfer the editing job')
    expect(page).toContain('<TransferEditingDialog open={transferOpen} itemId={item.id} itemTitle={item.title} currentOwnerId={item.owner_id ?? null}')
    const dialog = src('app/dashboard/board/TransferEditingDialog.tsx')
    expect(dialog).toContain('`/api/production/items/${itemId}/transfer-editing`')
    expect(dialog).toContain("EDITING_ROLES.includes(t.role) && t.id !== currentOwnerId")
  })
  it('a card nobody holds offers a manager "Assign an editor" — the same route, the plain words (16 Sep 2026)', () => {
    const page = src('app/dashboard/editor/[id]/page.tsx')
    expect(page).toContain('const unassigned = transferable && !item.owner_id')
    expect(page).toContain('Assign an editor')
    expect(page).toContain('{transferable && !unassigned && (')
    const dialog = src('app/dashboard/board/TransferEditingDialog.tsx')
    expect(dialog).toContain("<DialogTitle>{currentOwnerId ? 'Transfer the editing job' : 'Assign an editor'}</DialogTitle>")
    expect(dialog).toContain("currentOwnerId ? 'Transfer the editing' : 'Assign the editing'")
    expect(src('app/dashboard/board/EditorCardDrawer.tsx')).toContain("isManager ? 'Nobody is on this card yet — press Assign an editor.' : 'Nobody is on this card yet.'")
    // the Delivery only tick on the editing card, for a manager (16 Sep 2026)
    expect(page).toContain('Delivery only — the client posts this themselves. It ends at their approval; nothing goes to a scheduler.')
    expect(page).toContain('body: JSON.stringify({ deliver_only: on }),')
  })
})
