import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'

/**
 * "@NAME" IN A TEAM NOTE SENDS THAT PERSON AN EMAIL (the owner, 14 Sep
 * 2026: "tagging them in comments did not trigger a notification").
 *
 * Drives the REAL comments route on the in-memory database with the real
 * tag resolver; only the mailer is a stub that records what it was asked
 * to send. The tagged person is a team member saved with a BLANK name —
 * the case that used to be offered by the picker and matched by nobody.
 */
const ITEM = 'aaaaaaaa-0000-4000-8000-000000000031'
const AM = { id: 'u-am', role: 'account_manager', email: 'am@x.invalid', name: 'Ada', clerk_user_id: null }
const ED = { id: 'u-ed', role: 'editor', email: 'ed@x.invalid', name: 'Sam', clerk_user_id: null }
// no name on the row — the email is the only name "@" can use
const NONAME = { id: 'u-nn', role: 'editor', email: 'akmaltest@x.invalid', name: '', clerk_user_id: null }
const JOY = { id: 'u-qc', role: 'quality_checker', email: 'joy@x.invalid', name: 'Joy Quality', clerk_user_id: null }

const h = vi.hoisted(() => ({
  user: null as unknown as Record<string, unknown>,
  emails: [] as { recipientEmail: string; recipientId?: string | null; subject: string; bodyHtml: string; eventType: string }[],
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
  notify: vi.fn(async (input: { recipientEmail: string; recipientId?: string | null; subject: string; bodyHtml: string; eventType: string }) => { h.emails.push(input); return 'sent' }),
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

const { POST } = await import('../app/api/production/items/[id]/comments/route')

const say = async (body: string, extra: Record<string, unknown> = {}) => {
  const res = await POST(
    new Request(`https://x.test/api/production/items/${ITEM}/comments`, { method: 'POST', body: JSON.stringify({ body, visibility: 'internal', ...extra }) }),
    { params: Promise.resolve({ id: ITEM }) },
  )
  return { status: res.status, json: await res.json() as { id?: string; assigned_to?: string | null; error?: string } }
}

let fake: ReturnType<typeof seedDb>
beforeEach(() => {
  h.user = AM
  h.emails = []
  fake = seedDb({
    clients: [{ id: 'c1', name: 'Park Noire', timezone: 'Australia/Melbourne' }] as unknown as Row[],
    team_users: [AM, ED, NONAME, JOY].map(u => ({ ...u, active_status: true })) as unknown as Row[],
    team_user_clients: [{ id: 'l1', team_user_id: AM.id, client_id: 'c1' }] as unknown as Row[],
    content_items: [{
      id: ITEM, client_id: 'c1', title: 'Spring reel', status: 'quality_check', content_type: 'reel',
      owner_id: ED.id, scheduler_ids: [], current_version_number: 1, batch_id: null, client_approval_required: true,
    }] as unknown as Row[],
    item_comments: [], workflow_activity: [], notification_log: [],
  } as never)
})
afterEach(() => fake.restore())

const tagMails = () => h.emails.filter(e => e.eventType === 'comment_assigned')

describe('tagging somebody in a team note', () => {
  it('emails the tagged person once, with the words and their own board link', async () => {
    const r = await say('@Joy Quality can you look at the colour grade')
    expect(r.status).toBe(201)
    expect(r.json.assigned_to).toBe(JOY.id)
    const mails = tagMails()
    expect(mails.map(m => m.recipientEmail)).toEqual([JOY.email])
    expect(mails[0].subject).toBe('Ada tagged you on Spring reel')
    expect(mails[0].bodyHtml).toContain('can you look at the colour grade')
    expect(mails[0].bodyHtml).toContain(`card=${ITEM}`)
  })

  it('a member saved with a BLANK name is tagged by their email — the picker’s name and the server’s are the same (14 Sep 2026)', async () => {
    const r = await say(`@${NONAME.email} the second cut is yours`)
    expect(r.status).toBe(201)
    expect(r.json.assigned_to).toBe(NONAME.id)
    expect(tagMails().map(m => m.recipientEmail)).toEqual([NONAME.email])
  })

  it('two people tagged: both emailed, each once; the writer is never emailed about their own note', async () => {
    h.user = ED
    const r = await say(`@Joy Quality and @Ada — done, over to you. cc @Sam`)
    expect(r.status).toBe(201)
    expect(tagMails().map(m => m.recipientEmail).sort()).toEqual([AM.email, JOY.email].sort())
  })

  it('a name that is nobody on the team tags nobody and sends nothing', async () => {
    const r = await say('@Nobody Here please')
    expect(r.status).toBe(201)
    expect(r.json.assigned_to ?? null).toBeNull()
    expect(tagMails()).toHaveLength(0)
  })
})
