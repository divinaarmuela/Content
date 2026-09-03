import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import { visibleItems, type ScopeViewer } from '@/app/lib/scope-client'
import type { Row } from '@/lib/db-types'

/**
 * ONE scoping predicate, proved.
 *
 * `app/api/production/items/route.ts` used to restate the rule that
 * `app/lib/scope-client.ts` `visibleItems` implements, and the two were kept
 * honest by a test that read both and compared them by eye. The route now
 * CALLS `visibleItems`; this test holds it to that by running the real route
 * over a real (in-memory) database and demanding the ids back match
 * `visibleItems` over the same seed, for every role.
 */

const ROLES = ['super_admin', 'account_manager', 'editor', 'scheduler', 'client'] as const
type RoleName = typeof ROLES[number]

const VIEWERS: Record<RoleName, ScopeViewer> = {
  super_admin: { id: 'u-super', role: 'super_admin', client_id: null },
  account_manager: { id: 'u-am', role: 'account_manager', client_id: null },
  editor: { id: 'u-ed', role: 'editor', client_id: null },
  scheduler: { id: 'u-sch', role: 'scheduler', client_id: null },
  client: { id: 'u-cl', role: 'client', client_id: 'c1' },
}

let current: ScopeViewer = VIEWERS.super_admin

vi.mock('../app/lib/authz', () => ({
  requireSignedIn: async () => current,
  requireRole: async () => current,
  authzErrorResponse: (e: unknown) => ({
    error: e instanceof Error ? e.message : 'error', status: 500,
  }),
}))
vi.mock('../app/lib/production-live', () => ({
  announceItemChange: vi.fn(), announceBatchChange: vi.fn(),
}))
vi.mock('../app/lib/gdrive-hooks', () => ({ onItemsCreated: vi.fn(), onBatchCreated: vi.fn() }))

const { GET } = await import('../app/api/production/items/route')

const WORK_KINDS = [
  { id: 'wk-brief', slug: 'shoot_brief', name: 'Shoot plan', uses_media: true, active: true, sort_order: 0 },
  { id: 'wk-edit', slug: 'edit', name: 'Edit', uses_media: true, active: true, sort_order: 1 },
]
const BATCHES = [
  { id: 'b1', client_id: 'c1', title: 'March', status: 'booked', owner_id: 'u-am' },
  { id: 'b2', client_id: 'c2', title: 'April', status: 'booked', owner_id: 'u-ed' },
]
const ITEMS = [
  // on c1 (the editor's client, the client viewer's own client)
  { id: 'i1', client_id: 'c1', batch_id: 'b1', title: 'A', status: 'draft_uploaded', owner_id: 'u-am', work_kind_id: 'wk-edit', scheduler_ids: [], updated_at: '2026-01-05T00:00:00Z' },
  { id: 'i2', client_id: 'c1', batch_id: 'b1', title: 'B', status: 'approved_for_scheduling', owner_id: null, work_kind_id: 'wk-edit', scheduler_ids: [], updated_at: '2026-01-04T00:00:00Z' },
  // on c2 — nobody's client but reachable through assignment
  { id: 'i3', client_id: 'c2', batch_id: 'b2', title: 'C', status: 'approved_for_scheduling', owner_id: 'u-ed', work_kind_id: 'wk-edit', scheduler_ids: ['u-sch'], updated_at: '2026-01-03T00:00:00Z' },
  // a shoot plan: the scheduler post-filter drops it from the board
  { id: 'i4', client_id: 'c2', batch_id: 'b2', title: 'Plan', status: 'approved_for_scheduling', owner_id: 'u-am', work_kind_id: 'wk-brief', scheduler_ids: [], updated_at: '2026-01-02T00:00:00Z' },
  // on c3 — off everybody's roster, opened only by a comment tag
  { id: 'i5', client_id: 'c3', batch_id: null, title: 'Tagged', status: 'scheduled', owner_id: 'u-am', work_kind_id: 'wk-edit', scheduler_ids: [], updated_at: '2026-01-01T00:00:00Z' },
  // somebody else's private handoff: a scheduler not named on it never sees it
  { id: 'i6', client_id: 'c1', batch_id: null, title: 'Handed', status: 'approved_for_scheduling', owner_id: 'u-am', work_kind_id: 'wk-edit', scheduler_ids: ['u-other'], updated_at: '2025-12-31T00:00:00Z' },
]
const ASSIGNMENTS = [
  { id: 'u-am__c1', team_user_id: 'u-am', client_id: 'c1' },
  { id: 'u-ed__c1', team_user_id: 'u-ed', client_id: 'c1' },
]
const ITEM_COMMENTS = [
  { id: 'ic1', item_id: 'i5', body: 'look at this', assigned_to: 'u-ed', resolved: false, created_at: '2026-01-01T00:00:00Z' },
]
const BATCH_COMMENTS: Row[] = []

const SEED = {
  clients: [
    { id: 'c1', name: 'Acme', timezone: 'Australia/Melbourne' },
    { id: 'c2', name: 'Bee' },
    { id: 'c3', name: 'Cee' },
  ],
  content_items: ITEMS,
  batches: BATCHES,
  work_kinds: WORK_KINDS,
  team_user_clients: ASSIGNMENTS,
  item_comments: ITEM_COMMENTS,
  batch_comments: BATCH_COMMENTS,
  team_users: [
    { id: 'u-super', email: 'super@x.invalid', role: 'super_admin' },
    { id: 'u-am', email: 'am@x.invalid', role: 'account_manager' },
    { id: 'u-ed', email: 'ed@x.invalid', role: 'editor' },
    { id: 'u-sch', email: 'sch@x.invalid', role: 'scheduler' },
    { id: 'u-cl', email: 'cl@x.invalid', role: 'client', client_id: 'c1' },
  ],
  workflow_activity: [] as Row[],
  asset_versions: [] as Row[],
} as unknown as Parameters<typeof seedDb>[0]

let fake: ReturnType<typeof seedDb>
beforeEach(() => { fake = seedDb(SEED) })
afterEach(() => fake.restore())

/** `visibleItems` over the same seed, with the ctx the boards build. */
function expected(viewer: ScopeViewer): string[] {
  const tagsFor = (id: string) =>
    viewer.role === 'client' ? [] : ITEM_COMMENTS.filter(c => c.assigned_to === id).map(c => c.item_id)
  const rows = [...ITEMS].sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))
  return visibleItems(
    viewer,
    rows as never,
    viewer.role === 'super_admin' || viewer.role === 'client' ? [] : ASSIGNMENTS,
    {
      batches: viewer.role === 'client' ? [] : BATCHES,
      taggedItemIds: tagsFor(viewer.id),
      taggedBatchIds: [],
      workKinds: WORK_KINDS,
    },
  ).map(r => r.id)
}

describe('items GET scoping is visibleItems, for every role', () => {
  for (const role of ROLES) {
    it(`${role}: the route returns exactly what visibleItems returns`, async () => {
      current = VIEWERS[role]
      const res = await GET(new Request('https://x.test/api/production/items'))
      expect(res.status).toBe(200)
      const body = await res.json() as { id: string }[]
      expect(body.map(r => r.id)).toEqual(expected(VIEWERS[role]))
    })
  }

  it('the scheduler post-filter really is on: the shoot plan and the private handoff are gone', async () => {
    current = VIEWERS.scheduler
    const body = await (await GET(new Request('https://x.test/api/production/items'))).json() as { id: string }[]
    const ids = body.map(r => r.id)
    expect(ids).not.toContain('i4')   // a shoot plan is not scheduling work
    expect(ids).not.toContain('i6')   // handed to somebody else
    expect(ids).toContain('i3')       // handed to this scheduler
  })

  it('a comment tag opens an item off the roster — for the route and for visibleItems alike', async () => {
    current = VIEWERS.editor
    const body = await (await GET(new Request('https://x.test/api/production/items'))).json() as { id: string }[]
    expect(body.map(r => r.id)).toContain('i5')
  })

  it('the status and batch filters still narrow the same scoped list', async () => {
    current = VIEWERS.super_admin
    const byStatus = await (await GET(new Request('https://x.test/api/production/items?status=scheduled'))).json() as { id: string }[]
    expect(byStatus.map(r => r.id)).toEqual(['i5'])
    const byBatch = await (await GET(new Request('https://x.test/api/production/items?batch_id=b2'))).json() as { id: string }[]
    expect(byBatch.map(r => r.id).sort()).toEqual(['i3', 'i4'])
    const byClient = await (await GET(new Request('https://x.test/api/production/items?client_id=c3'))).json() as { id: string }[]
    expect(byClient.map(r => r.id)).toEqual(['i5'])
  })
})
