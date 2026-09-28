import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'
import {
  clientRecipients, itemApprovalLink, pickRecipients, sendOutcomeWords,
} from '../app/lib/post-to-client-core'

/**
 * SEND TO CLIENT (the owner, 28 Sep 2026: "at With client it should be sent to the client — confirming the emails
 * that will receive it; an AM or super admin can do it; once approved it goes Ready to post").
 */
describe('who can be sent to', () => {
  const client = { name: 'Jordan Wilson', email: 'Jordan@Example.com' }
  const contacts = [
    { name: 'Assistant', email: 'assist@example.com', role: 'Marketing', is_primary: false },
    { name: 'Jordan', email: 'jordan@example.com', role: 'Owner', is_primary: true },
    { name: 'No email', email: '', role: '', is_primary: false },
    { name: 'Bad', email: 'not-an-email', role: '', is_primary: false },
  ]
  it('the client\'s own address and its people, each once, main first, junk left out', () => {
    const r = clientRecipients(client, contacts)
    expect(r.map(x => x.email)).toEqual(['jordan@example.com', 'assist@example.com'])
    expect(r[0].primary).toBe(true)
  })
  it('only addresses on the client\'s list are accepted — never one typed into the request', () => {
    const list = clientRecipients(client, contacts)
    expect(pickRecipients(['JORDAN@example.com'], list)).toEqual({ ok: true, emails: ['jordan@example.com'] })
    const stranger = pickRecipients(['jordan@example.com', 'someone@else.com'], list)
    expect(stranger.ok).toBe(false)
    expect((stranger as { error: string }).error).toContain('someone@else.com')
    expect(pickRecipients([], list)).toMatchObject({ ok: false })
    expect(pickRecipients(['a@b.co'], [])).toMatchObject({ ok: false, error: expect.stringContaining('no email address') })
  })
  it('the link opens this card on the client\'s portal', () => {
    expect(itemApprovalLink('https://app.mdmmarketing.com.au/', 'tok-1', 'item-9')).toBe('https://app.mdmmarketing.com.au/portal/tok-1/approve/item-9')
  })
  it('says what actually happened to each address', () => {
    expect(sendOutcomeWords([{ email: 'a@x.com', result: 'sent' }])).toBe('Emailed a@x.com the link to view and approve it.')
    expect(sendOutcomeWords([{ email: 'a@x.com', result: 'sent' }, { email: 'b@x.com', result: 'failed' }])).toContain('Could not email b@x.com')
    expect(sendOutcomeWords([{ email: 'a@x.com', result: 'muted' }])).toMatch(/^Nothing was sent/)
  })
})

/* ── the route, against an in-memory database ─────────────────────────────── */
const user = { id: 'am-1', role: 'account_manager', name: 'Manal', email: 'manal@mdmmarketing.com.au' }
let role = 'account_manager'
const notify = vi.fn(async (_input: Record<string, unknown>) => 'sent' as string)
vi.mock('../app/lib/authz', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../app/lib/authz')
  return {
    ...actual,
    requireRole: async (_min: string) => {
      if (role === 'scheduler') throw new (actual.AuthzError as new (m: string, s: number) => Error)('Forbidden', 403)
      return { ...user, role }
    },
  }
})
vi.mock('../app/lib/production-access', () => ({
  loadItemForUser: async (_u: unknown, id: string) => {
    const { table } = await import('@/lib/db')
    return table('content_items').get(id)
  },
}))
vi.mock('../app/lib/workflow', () => ({ logActivity: vi.fn(async () => undefined) }))
vi.mock('../app/lib/mailer', () => ({ notify, renderEmail: (t: string, b: string, l?: string, u?: string) => `${t}${b}${l ?? ''}${u ?? ''}`, escapeHtml: (s: string) => s }))

let fake: ReturnType<typeof seedDb>
const seed = (status: string, token: string | null = 'tok-1') => seedDb({
  content_items: [{ id: 'item-1', client_id: 'c1', title: 'Carousel 11', status, caption: 'Hello' }] as unknown as Row[],
  clients: [{ id: 'c1', name: 'Jordan Wilson', email: 'jordan@example.com', share_token: token }] as unknown as Row[],
  client_contacts: [{ id: 'k1', client_id: 'c1', name: 'Assistant', email: 'assist@example.com', role: 'Marketing', is_primary: false }] as unknown as Row[],
})
beforeEach(() => { role = 'account_manager'; notify.mockClear(); notify.mockImplementation(async () => 'sent') })
afterEach(() => fake?.restore())

const call = async (method: 'GET' | 'POST', body?: unknown) => {
  const mod = await import('../app/api/production/items/[id]/send-to-client/route')
  const req = new Request('https://x.test/api', { method, ...(body ? { body: JSON.stringify(body) } : {}) })
  const res = await (method === 'GET' ? mod.GET(req, { params: Promise.resolve({ id: 'item-1' }) }) : mod.POST(req, { params: Promise.resolve({ id: 'item-1' }) }))
  return { status: res.status, json: await res.json() as Record<string, unknown> }
}

describe('POST /api/production/items/:id/send-to-client', () => {
  it('lists the client\'s addresses and says whether it can be sent', async () => {
    fake = seed('client_review')
    const r = await call('GET')
    expect(r.status).toBe(200)
    expect((r.json.recipients as { email: string }[]).map(x => x.email)).toEqual(['jordan@example.com', 'assist@example.com'])
    expect(r.json).toMatchObject({ sendable: true, has_portal: true })
  })

  it('emails each chosen address the portal link, as a deliberate client send', async () => {
    fake = seed('client_review')
    const r = await call('POST', { emails: ['jordan@example.com', 'assist@example.com'], note: 'By Thursday please' })
    expect(r.status).toBe(200)
    expect(r.json.sent).toEqual(['jordan@example.com', 'assist@example.com'])
    expect(notify).toHaveBeenCalledTimes(2)
    const first = notify.mock.calls[0][0]
    expect(first).toMatchObject({ recipientEmail: 'jordan@example.com', toClient: true, deliberateClientSend: true })
    expect(String(first.bodyHtml)).toContain('https://app.mdmmarketing.com.au/portal/tok-1/approve/item-1')
    expect(String(first.bodyHtml)).toContain('By Thursday please')
    // nothing moved — the client's Approve (or Log the client's approval) is what moves it
    expect((fake.rows('content_items')[0] as unknown as { status: string }).status).toBe('client_review')
  })

  it('refuses a card that is not With client', async () => {
    fake = seed('quality_check')
    const r = await call('POST', { emails: ['jordan@example.com'] })
    expect(r.status).toBe(409)
    expect(notify).not.toHaveBeenCalled()
  })

  it('refuses an address that is not on the client', async () => {
    fake = seed('client_review')
    const r = await call('POST', { emails: ['someone@else.com'] })
    expect(r.status).toBe(400)
    expect(notify).not.toHaveBeenCalled()
  })

  it('refuses a client with no portal link', async () => {
    fake = seed('client_review', null)
    const r = await call('POST', { emails: ['jordan@example.com'] })
    expect(r.status).toBe(409)
  })

  it('refuses anyone below an account manager', async () => {
    fake = seed('client_review')
    role = 'scheduler'
    const r = await call('POST', { emails: ['jordan@example.com'] })
    expect(r.status).toBe(403)
    expect(notify).not.toHaveBeenCalled()
  })

  it('never claims it sent when the mailer did not', async () => {
    fake = seed('client_review')
    notify.mockImplementation(async () => 'failed')
    const r = await call('POST', { emails: ['jordan@example.com'] })
    expect(r.status).toBe(502)
    expect(String(r.json.message)).toMatch(/^Nothing was sent/)
  })
})

describe('where it is on the page', () => {
  it('the Post approval drawer and card offer it to a manager at With client; the portal lets the client approve an uploaded post', () => {
    const drawer = readFileSync('app/dashboard/board/PostApprovalDetail.tsx', 'utf8')
    expect(drawer).toContain('const maySendToClient = isManager && !!item && sendStage(item as never) !== null')
    const card = readFileSync('app/dashboard/board/BoardCard.tsx', 'utf8')
    expect(card).toContain("page === 'scheduler' && sendStage(card as never) !== null && (viewer.role === 'account_manager' || viewer.role === 'super_admin')")
    // and the Schedule page's post window — where Divina sends posts for approval — opens the same dialog
    expect(readFileSync('app/dashboard/social/schedule/NewPostDialog.tsx', 'utf8')).toContain('<SendToClientDialog itemId={target.itemId}')
    const portal = readFileSync('app/components/portal/PortalBoard.tsx', 'utf8')
    expect(portal).toContain('const decides = true')
  })
})

describe('the final post, once the edit is approved (28 Sep 2026: "send for approval to actual clients")', () => {
  it('is sendable while its post waits on sign-off, and becomes the client\'s to answer', async () => {
    const { sendStage } = await import('../app/lib/post-to-client-core')
    expect(sendStage({ status: 'client_review' })).toBe('card')
    expect(sendStage({ status: 'approved_for_scheduling', posting_approval_state: 'pending' })).toBe('post')
    expect(sendStage({ status: 'approved_for_scheduling', posting_approval_state: 'approved' })).toBeNull()
    expect(sendStage({ status: 'quality_check' })).toBeNull()
    fake = seedDb({
      content_items: [{ id: 'item-1', client_id: 'c1', title: '11', status: 'approved_for_scheduling', posting_approval_state: 'pending', posting_client_required: false }] as unknown as Row[],
      clients: [{ id: 'c1', name: 'Jordan Wilson', email: 'jordan@example.com', share_token: 'tok-1' }] as unknown as Row[],
      client_contacts: [] as unknown as Row[],
    })
    const r = await call('POST', { emails: ['jordan@example.com'] })
    expect(r.status).toBe(200)
    expect((fake.rows('content_items')[0] as unknown as { posting_client_required: boolean }).posting_client_required).toBe(true)
    expect(String(notify.mock.calls[0][0].subject)).toContain('Your post is ready to approve')
  })
})

describe('send me a test first (28 Sep 2026)', () => {
  it('emails only the person pressing it, as team mail, with the page in preview — and nothing on the post moves', async () => {
    fake = seedDb({
      content_items: [{ id: 'item-1', client_id: 'c1', title: '11', status: 'approved_for_scheduling', posting_approval_state: 'pending', posting_client_required: false }] as unknown as Row[],
      clients: [{ id: 'c1', name: 'Jordan Wilson', email: 'jordan@example.com', share_token: 'tok-1' }] as unknown as Row[],
      client_contacts: [] as unknown as Row[],
      social_posts: [{ id: 'p1', item_id: 'item-1', status: 'pending', caption: 'Where it started.', updated_at: '2026-09-28T02:00:00Z' }] as unknown as Row[],
    })
    const r = await call('POST', { test: true, emails: ['jordan@example.com'] })
    expect(r.status).toBe(200)
    expect(notify).toHaveBeenCalledTimes(1)
    const sent = notify.mock.calls[0][0]
    expect(sent).toMatchObject({ recipientEmail: 'manal@mdmmarketing.com.au', toClient: false, deliberateClientSend: false })
    expect(String(sent.subject)).toMatch(/^\[Test — what Jordan Wilson gets\]/)
    expect(String(sent.bodyHtml)).toContain('/portal/tok-1/approve/item-1?preview=1')
    expect(String(sent.bodyHtml)).toContain('Where it started.')
    expect((fake.rows('content_items')[0] as unknown as { posting_client_required: boolean }).posting_client_required).toBe(false)
  })
})

describe('the client hears from Divina (the owner, 28 Sep 2026: "it should be from Divina")', () => {
  it('whoever presses Send, the email is in Divina\'s name, and falls back to the sender if she is inactive', async () => {
    fake = seedDb({
      content_items: [{ id: 'item-1', client_id: 'c1', title: '11', status: 'client_review' }] as unknown as Row[],
      clients: [{ id: 'c1', name: 'Jordan Wilson', email: 'jordan@example.com', share_token: 'tok-1' }] as unknown as Row[],
      client_contacts: [] as unknown as Row[],
      team_users: [{ id: '54926a48-335e-46e9-a080-df8c1ad42ac9', name: 'Divina', email: 'divina@mdmmarketing.com.au', active_status: true }] as unknown as Row[],
    })
    await call('POST', { emails: ['jordan@example.com'] })
    expect(notify.mock.calls[0][0]).toMatchObject({ actorName: 'Divina', actorEmail: 'divina@mdmmarketing.com.au' })
    expect(String(notify.mock.calls[0][0].bodyHtml)).toContain('Divina has sent you')
  })
})

describe('once sent, the button says so (28 Sep 2026)', () => {
  it('a real send stamps the card; the stamp counts only for the moment it was sent in', async () => {
    const { sentForStage, sentWords } = await import('../app/lib/post-to-client-core')
    fake = seedDb({
      content_items: [{ id: 'item-1', client_id: 'c1', title: '11', status: 'approved_for_scheduling', posting_approval_state: 'pending' }] as unknown as Row[],
      clients: [{ id: 'c1', name: 'Jordan Wilson', email: 'jordan@example.com', share_token: 'tok-1' }] as unknown as Row[],
      client_contacts: [] as unknown as Row[],
    })
    await call('POST', { emails: ['jordan@example.com'] })
    const row = fake.rows('content_items')[0] as unknown as Record<string, unknown>
    const s = sentForStage(row as never)
    expect(s).toMatchObject({ to: ['jordan@example.com'], stage: 'post' })
    expect(sentWords(s!)).toMatch(/^Emailed to jordan@example\.com · /)
    // a later moment (the card back With client) is not "already sent"
    expect(sentForStage({ ...row, status: 'client_review' } as never)).toBeNull()
    // and a test never stamps
    fake.restore()
    fake = seedDb({
      content_items: [{ id: 'item-1', client_id: 'c1', title: '11', status: 'client_review' }] as unknown as Row[],
      clients: [{ id: 'c1', name: 'Jordan Wilson', email: 'jordan@example.com', share_token: 'tok-1' }] as unknown as Row[],
      client_contacts: [] as unknown as Row[],
    })
    await call('POST', { test: true })
    expect((fake.rows('content_items')[0] as unknown as { client_sent?: unknown }).client_sent).toBeUndefined()
  })
})
