import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'
import { DELIVERED_ACTION } from '../app/lib/deliver-only-core'

/**
 * DELIVER ONLY: THE CLIENT POSTS THEIR OWN CONTENT (the playbook's Bond Street).
 *
 * The owner, 11 Sep 2026: "yes super admin can pass quality check" — allowed,
 * no reason asked. But it is written into the card's history as a stand-in
 * and every flagged reviewer is emailed, so Joy knows what went past her.
 * With nobody flagged the super admin IS the reviewer: no mark, no email.
 * Drives the REAL transition route and `performTransition` on the in-memory
 * database.
 */

const ITEM = 'aaaaaaaa-0000-4000-8000-000000000003'
const CATH = { id: 'u-cath', role: 'scheduler', email: 'cath@x.invalid', name: 'Cath', clerk_user_id: null }
const OWNER = { id: 'u-ed', role: 'editor', email: 'ed@x.invalid', name: 'Eden', clerk_user_id: null }
const JOY = { id: 'u-joy', role: 'account_manager', email: 'joy@x.invalid', name: 'Joy', clerk_user_id: null, quality_reviewer: true }
const SUPER = { id: 'u-sa', role: 'super_admin', email: 'sa@x.invalid', name: 'Akmal', clerk_user_id: null, quality_reviewer: false }

const h = vi.hoisted(() => ({
  user: null as unknown as Record<string, unknown>,
  emails: [] as Record<string, unknown>[],
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
  notify: vi.fn(async (m: Record<string, unknown>) => { h.emails.push(m); return 'sent' }),
  renderEmail: (_s: string, body: string) => body,
  escapeHtml: (s: string) => s,
}))
vi.mock('../app/lib/gdrive-mirror', () => ({
  mirrorLatestVersionSoon: vi.fn(), mirrorVersionSlides: vi.fn(),
  mirrorRawAssets: vi.fn(), newRawAssets: () => [],
}))
vi.mock('../app/lib/stream', () => ({ previewVideos: vi.fn() }))
vi.mock('../app/lib/production-live', () => ({
  announceItemChange: vi.fn(), announceBatchChange: vi.fn(),
}))
vi.mock('../lib/live', () => ({ announce: vi.fn(), announceAfter: vi.fn() }))
vi.mock('../app/inngest/client', () => ({ inngest: { send: vi.fn(async () => ({})) } }))

const { POST } = await import('../app/api/production/items/[id]/transition/route')

const move = async (to: string) => {
  const res = await POST(
    new Request(`https://x.test/api/production/items/${ITEM}/transition`, { method: 'POST', body: JSON.stringify({ to }) }),
    { params: Promise.resolve({ id: ITEM }) },
  )
  return { status: res.status, json: await res.json() as any }
}
const drain = () => new Promise(r => setTimeout(r, 30))

let fake: ReturnType<typeof seedDb>
const activity = () => fake.rows('workflow_activity') as Record<string, unknown>[]
const item = () => fake.rows('content_items').find(r => r.id === ITEM) as Record<string, unknown>

const seed = (over: { client?: Record<string, unknown>; item?: Record<string, unknown> } = {}) => seedDb({
  clients: [{ id: 'c1', name: 'Bond Street', timezone: 'Australia/Melbourne', default_scheduler_ids: [CATH.id], posts_own_content: true, ...over.client }] as unknown as Row[],
  team_users: [OWNER, JOY, SUPER, CATH].map(u => ({ ...u, active_status: true })) as unknown as Row[],
  team_user_clients: [{ id: `${JOY.id}__c1`, team_user_id: JOY.id, client_id: 'c1' }] as unknown as Row[],
  content_items: [{
    id: ITEM, client_id: 'c1', title: 'Menu carousel', status: 'quality_check', content_type: 'carousel',
    owner_id: OWNER.id, scheduler_ids: [], current_version_number: 1, batch_id: null,
    work_kind_id: null, client_approval_required: false, due_date: null, ...over.item,
  }] as unknown as Row[],
  asset_versions: [{ id: 'v1', item_id: ITEM, version_number: 1, files: [{ url: 'https://r2/a.jpg', name: 'a.jpg', type: 'image' }], file_url: 'https://r2/a.jpg' }] as unknown as Row[],
})

beforeEach(() => { h.emails = [] })
afterEach(() => fake.restore())

describe('a deliver-only card at the client’s approval', () => {
  it('is delivered: no scheduler is handed it, nobody is told to book it, the history says so', async () => {
    fake = seed()
    h.user = JOY
    const r = await move('approved_for_scheduling')
    await drain()
    expect(r.status).toBe(200)
    expect(r.json.status).toBe('approved_for_scheduling')
    // the client's default scheduler is NOT handed the card
    expect(item().scheduler_ids ?? []).toEqual([])
    expect(activity().some(a => a.action === 'schedule_handoff')).toBe(false)
    // …and is not told anything
    expect(h.emails.some(e => e.recipientId === CATH.id)).toBe(false)
    // the card's own history line
    expect(activity().some(a => a.action === DELIVERED_ACTION)).toBe(true)
  })

  it('pins the choice on the card at approval, so flipping the client setting later moves nothing', async () => {
    fake = seed()
    h.user = JOY
    await move('approved_for_scheduling')
    await drain()
    expect(item().deliver_only).toBe(true)
    // and a client who has us post: the card is pinned to that too
    fake.restore()
    fake = seed({ client: { posts_own_content: false } })
    h.user = JOY
    await move('approved_for_scheduling')
    await drain()
    expect(item().deliver_only).toBe(false)
    expect(item().scheduler_ids).toEqual([CATH.id])
  })

  it('the card’s own word overrides the client: deliver_only false means we post it', async () => {
    fake = seed({ item: { deliver_only: false } })
    h.user = JOY
    const r = await move('approved_for_scheduling')
    await drain()
    expect(r.status).toBe(200)
    expect(item().scheduler_ids).toEqual([CATH.id])
    expect(activity().some(a => a.action === DELIVERED_ACTION)).toBe(false)
  })

  it('a card marked deliver-only on an ordinary client ends at delivered too', async () => {
    fake = seed({ client: { posts_own_content: false }, item: { deliver_only: true } })
    h.user = JOY
    await move('approved_for_scheduling')
    await drain()
    expect(item().scheduler_ids ?? []).toEqual([])
    expect(h.emails.some(e => e.recipientId === CATH.id)).toBe(false)
    expect(activity().some(a => a.action === DELIVERED_ACTION)).toBe(true)
  })
})
