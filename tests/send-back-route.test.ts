import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'

/**
 * SEND BACK FOR CHANGES — the round trip.
 *
 * The manager reads the client's thread, writes what needs changing, and
 * the card goes to Internal check through the ordinary transitions, the
 * words land on the card, and the person ASSIGNED hears — bell and email —
 * in the manager's words. Drives the REAL `performTransition` on the
 * in-memory database, so the moves are the machine's, not a mock's.
 */

const ITEM = 'aaaaaaaa-0000-4000-8000-000000000001'
const OWNER = { id: 'u-ed', role: 'editor', email: 'ed@x.invalid', name: 'Eden', clerk_user_id: null }
const AM = { id: 'u-am', role: 'account_manager', email: 'am@x.invalid', name: 'Ada', clerk_user_id: null }
const AM2 = { id: 'u-am2', role: 'account_manager', email: 'am2@x.invalid', name: 'Bea', clerk_user_id: null }
const SCHED = { id: 'u-sc', role: 'scheduler', email: 'sc@x.invalid', name: 'Sam', clerk_user_id: null }

const h = vi.hoisted(() => ({
  user: null as unknown as Record<string, unknown>,
  emails: [] as Record<string, unknown>[],
  /** when set, the loader hands the route a snapshot with THIS status —
   *  the card as it was a moment ago, not as it is now */
  staleStatus: null as string | null,
}))

vi.mock('../app/lib/authz', () => ({
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
    const row = await table('content_items').get(id)
    if (!row) throw Object.assign(new Error('Item not found'), { status: 404 })
    return h.staleStatus ? { ...row, status: h.staleStatus } : row
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

const { POST } = await import('../app/api/production/items/[id]/send-back/route')

const post = async (note: unknown) => {
  const res = await POST(
    new Request(`https://x.test/api/production/items/${ITEM}/send-back`, { method: 'POST', body: JSON.stringify({ note }) }),
    { params: Promise.resolve({ id: ITEM }) },
  )
  return { status: res.status, json: await res.json() as any }
}

/** the transition fan-out is fire-and-forget; let it drain */
const drain = () => new Promise(r => setTimeout(r, 20))

let fake: ReturnType<typeof seedDb>
const item = () => fake.rows('content_items')[0] as Record<string, unknown>
const activity = () => fake.rows('workflow_activity') as Record<string, unknown>[]

const seed = (status: string, owner: string | null = OWNER.id) => seedDb({
  clients: [{ id: 'c1', name: 'Acme', timezone: 'Australia/Melbourne' }] as unknown as Row[],
  team_users: [OWNER, AM, AM2, SCHED].map(u => ({ ...u, active_status: true })) as unknown as Row[],
  team_user_clients: [
    { id: `${AM.id}__c1`, team_user_id: AM.id, client_id: 'c1' },
    { id: `${AM2.id}__c1`, team_user_id: AM2.id, client_id: 'c1' },
  ] as unknown as Row[],
  content_items: [{
    id: ITEM, client_id: 'c1', title: 'Winter reel', status, content_type: 'reel',
    owner_id: owner, scheduler_ids: [], current_version_number: 1, batch_id: null,
    work_kind_id: null, client_approval_required: true, due_date: null,
  }] as unknown as Row[],
  item_comments: [
    { id: 'cm-1', item_id: ITEM, author_id: 'u-client', visibility: 'client', body: 'Logo too small', resolved: false, created_at: '2026-09-06T01:00:00Z' },
  ] as unknown as Row[],
})

beforeEach(() => { h.user = AM; h.emails = []; h.staleStatus = null })
afterEach(() => fake.restore())

describe('POST /api/production/items/[id]/send-back', () => {
  it('from With client (waiting): logs the client\'s changes, then sends for revision — the ordinary edges', async () => {
    fake = seed('client_review')
    const r = await post('Make the logo bigger and swap the music')
    await drain()
    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({
      ok: true, status: 'revision_required', column: 'internal_check',
      steps: [
        { from: 'client_review', to: 'client_changes_requested' },
        { from: 'client_changes_requested', to: 'revision_required', label: 'Send for revision' },
      ],
      notified: { id: OWNER.id, name: 'Eden' },
    })
    expect(item().status).toBe('revision_required')
    // the machine logged both moves under their own labels
    const moves = activity().filter(a => a.action === 'status_change').map(a => `${a.old_value}>${a.new_value}`)
    expect(moves).toEqual(['client_review>client_changes_requested', 'client_changes_requested>revision_required'])
  })

  it('records the words on the card and in its thread, tagged to the assignee', async () => {
    fake = seed('client_changes_requested')
    await post('Bigger logo, please')
    await drain()
    expect(item()).toMatchObject({ change_note: 'Bigger logo, please', change_note_by: AM.id })
    expect(typeof item().change_note_at).toBe('string')
    const thread = fake.rows('item_comments') as Record<string, unknown>[]
    const mine = thread.find(c => c.body === 'Bigger logo, please')
    expect(mine).toMatchObject({ visibility: 'internal', assigned_to: OWNER.id, author_id: AM.id, resolved: false })
    expect(activity().find(a => a.action === 'sent_back')).toMatchObject({ detail: 'Bigger logo, please' })
  })

  it('tells the person ASSIGNED — once, bell and email, in the manager\'s words — and nobody else', async () => {
    fake = seed('client_changes_requested')
    await post('Bigger logo, please')
    await drain()
    const toOwner = h.emails.filter(e => e.recipientId === OWNER.id)
    expect(toOwner).toHaveLength(1)
    expect(toOwner[0]).toMatchObject({
      eventType: 'sent_back', recipientEmail: OWNER.email, subject: 'Winter reel — what needs changing',
    })
    // bell AND email: not a bell-only row
    expect(toOwner[0].bellOnly).toBeFalsy()
    expect(String(toOwner[0].bodyHtml)).toContain('Bigger logo, please')
    // the transition's own fan-out to the owner was skipped, and the other
    // manager is not told about a note that was not theirs to act on
    expect(h.emails.map(e => e.recipientId)).toEqual([OWNER.id])
  })

  it('from Internal check (waiting for the manager): asks for changes', async () => {
    fake = seed('internal_review')
    const r = await post('Trim the intro')
    await drain()
    expect(r.json).toMatchObject({
      status: 'revision_required',
      steps: [{ from: 'internal_review', to: 'revision_required', label: 'Ask for changes' }],
    })
  })

  it('already being revised: adds the words and tells the assignee again, no move', async () => {
    fake = seed('revision_required')
    const r = await post('One more thing — the caption')
    await drain()
    expect(r.json).toMatchObject({ status: 'revision_required', steps: [] })
    expect(item().change_note).toBe('One more thing — the caption')
    expect(h.emails).toHaveLength(1)
  })

  it('a card with nobody assigned still moves; nobody is emailed', async () => {
    fake = seed('client_changes_requested', null)
    const r = await post('Bigger logo')
    await drain()
    expect(r.json).toMatchObject({ status: 'revision_required', notified: null })
    expect(h.emails).toEqual([])
  })

  it('refuses without the words — the assignee must know what to change', async () => {
    fake = seed('client_changes_requested')
    const r = await post('   ')
    expect(r.status).toBe(400)
    expect(r.json.error).toBe('Say what needs changing first')
    expect(item().status).toBe('client_changes_requested')
  })

  it('an editor or a scheduler may not send a card back', async () => {
    fake = seed('client_changes_requested')
    h.user = OWNER
    expect((await post('x')).status).toBe(403)
    h.user = SCHED
    expect((await post('x')).status).toBe(403)
    expect(item().status).toBe('client_changes_requested')
  })

  it('a card past the client (ready to post) cannot be sent back this way', async () => {
    fake = seed('approved_for_scheduling')
    const r = await post('Changed my mind')
    expect(r.status).toBe(403)
    expect(r.json.error).toBe('Nothing moves from Needs a posting date to Internal check')
    expect(item().status).toBe('approved_for_scheduling')
  })

  it('a stale snapshot is refused by the machine\'s own guard, not replayed', async () => {
    // the manager next door already sent it for revision; this request is
    // still working from the card as it was when the page loaded
    fake = seed('revision_required')
    h.staleStatus = 'client_changes_requested'
    const r = await post('Bigger logo')
    expect(r.status).toBe(409)
    expect(r.json.error).toBe('This item was just updated by someone else — refresh and try again')
    // nothing was written: no note, no thread line, no email
    expect(item().change_note).toBeUndefined()
    expect(h.emails).toEqual([])
  })
})
