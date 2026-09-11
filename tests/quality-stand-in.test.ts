import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'
import { STAND_IN_MARK } from '../app/lib/card-history-core'

/**
 * A SUPER ADMIN PASSES THE QUALITY CHECK IN THE REVIEWER'S PLACE.
 *
 * The owner, 11 Sep 2026: "yes super admin can pass quality check" — allowed,
 * no reason asked. But it is written into the card's history as a stand-in
 * and every flagged reviewer is emailed, so Joy knows what went past her.
 * With nobody flagged the super admin IS the reviewer: no mark, no email.
 * Drives the REAL transition route and `performTransition` on the in-memory
 * database.
 */

const ITEM = 'aaaaaaaa-0000-4000-8000-000000000002'
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
const passRow = () => activity().find(a => a.action === 'status_change' && a.new_value === 'client_review')

const seed = (people: Record<string, unknown>[]) => seedDb({
  clients: [{ id: 'c1', name: 'Acme', timezone: 'Australia/Melbourne', default_scheduler_ids: [] }] as unknown as Row[],
  team_users: people.map(u => ({ ...u, active_status: true })) as unknown as Row[],
  team_user_clients: people.filter(u => u.role === 'account_manager')
    .map(u => ({ id: `${u.id}__c1`, team_user_id: u.id, client_id: 'c1' })) as unknown as Row[],
  content_items: [{
    id: ITEM, client_id: 'c1', title: 'Winter reel', status: 'quality_check', content_type: 'reel',
    owner_id: OWNER.id, scheduler_ids: [], current_version_number: 1, batch_id: null,
    work_kind_id: null, client_approval_required: true, due_date: null,
  }] as unknown as Row[],
  asset_versions: [{ id: 'v1', item_id: ITEM, version_number: 1, files: [{ url: 'https://r2/x.mp4', name: 'x.mp4', type: 'video' }], file_url: 'https://r2/x.mp4' }] as unknown as Row[],
})

beforeEach(() => { h.emails = [] })
afterEach(() => fake.restore())

describe('a super admin passing the quality check', () => {
  it('is allowed with a reviewer flagged, marked as a stand-in, and the reviewer is told', async () => {
    fake = seed([OWNER, JOY, SUPER])
    h.user = SUPER
    const r = await move('client_review')
    await drain()
    expect(r.status).toBe(200)
    expect(r.json.status).toBe('client_review')
    expect(String(passRow()?.detail)).toContain(STAND_IN_MARK)
    const toJoy = h.emails.filter(e => e.recipientId === JOY.id && e.eventType === 'quality_stand_in')
    expect(toJoy).toHaveLength(1)
    expect(String(toJoy[0].subject)).toMatch(/passed in your place/)
    // the super admin is never emailed about their own pass
    expect(h.emails.some(e => e.recipientId === SUPER.id && e.eventType === 'quality_stand_in')).toBe(false)
  })

  it('is the reviewer themselves when nobody is flagged: no mark, no email', async () => {
    fake = seed([OWNER, SUPER])
    h.user = SUPER
    const r = await move('client_review')
    await drain()
    expect(r.status).toBe(200)
    expect(String(passRow()?.detail)).not.toContain(STAND_IN_MARK)
    expect(h.emails.some(e => e.eventType === 'quality_stand_in')).toBe(false)
  })

  it('the flagged reviewer’s own pass is not a stand-in', async () => {
    fake = seed([OWNER, JOY, SUPER])
    h.user = JOY
    const r = await move('client_review')
    await drain()
    expect(r.status).toBe(200)
    expect(String(passRow()?.detail)).not.toContain(STAND_IN_MARK)
    expect(h.emails.some(e => e.eventType === 'quality_stand_in')).toBe(false)
  })
})
