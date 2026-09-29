import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'
import { clientRecipients, pickRecipients, postApprovalLink } from '../app/lib/post-stage'

/**
 * SEND TO CLIENT (the owner, 28 Sep 2026: "at With client it should be sent to the client — confirming the emails
 * that will receive it; an AM or super admin can do it").
 *
 * Since the posting rebuild (29 Sep 2026) the route does two separate things: the EDIT card at With client is
 * emailed as before; a POST is only a door onto the one writer (app/lib/post-stage.ts), which freezes the version,
 * emails it, and moves the post only once something reached the client (audit P9, V9, V10).
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
  it('a post\'s link opens that one post on the client\'s portal', () => {
    expect(postApprovalLink('https://app.mdmmarketing.com.au/', 'tok-1', 'post-9')).toBe('https://app.mdmmarketing.com.au/portal/tok-1/post/post-9')
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

const engine = await import('../app/lib/post-stage')

let fake: ReturnType<typeof seedDb>
let undo: () => void = () => {}
const seed = (status: string, token: string | null = 'tok-1', extra: Record<string, Row[]> = {}) => seedDb({
  content_items: [{ id: 'item-1', client_id: 'c1', title: 'Carousel 11', status, caption: 'Hello' }] as unknown as Row[],
  clients: [{ id: 'c1', name: 'Jordan Wilson', email: 'jordan@example.com', share_token: token }] as unknown as Row[],
  client_contacts: [{ id: 'k1', client_id: 'c1', name: 'Assistant', email: 'assist@example.com', role: 'Marketing', is_primary: false }] as unknown as Row[],
  ...extra,
} as never)
beforeEach(() => {
  role = 'account_manager'
  notify.mockClear()
  notify.mockImplementation(async () => 'sent')
  // the real delivery (it emails through the mocked mailer); the rest of the engine's outside world faked
  undo = engine.usePostEngineDeps({ mayActOnClient: async () => true, notify: async () => {}, announce: () => {} })
})
afterEach(() => { fake?.restore(); undo() })

const call = async (method: 'GET' | 'POST', body?: unknown) => {
  const mod = await import('../app/api/production/items/[id]/send-to-client/route')
  const req = new Request('https://x.test/api', { method, ...(body ? { body: JSON.stringify(body) } : {}) })
  const res = await (method === 'GET' ? mod.GET(req, { params: Promise.resolve({ id: 'item-1' }) }) : mod.POST(req, { params: Promise.resolve({ id: 'item-1' }) }))
  return { status: res.status, json: await res.json() as Record<string, unknown> }
}

describe('the EDIT card: POST /api/production/items/:id/send-to-client', () => {
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
    // nothing moved — the client's Approve is what moves it
    expect((fake.rows('content_items')[0] as unknown as { status: string }).status).toBe('client_review')
  })

  it('refuses a card that is not With client — a post is sent from its own window', async () => {
    fake = seed('approved_for_scheduling')
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

  it('a test goes only to the person pressing it, opens the card on the dashboard, and stamps nothing', async () => {
    fake = seed('client_review')
    const r = await call('POST', { test: true })
    expect(r.status).toBe(200)
    expect(notify.mock.calls[0][0]).toMatchObject({ recipientEmail: 'manal@mdmmarketing.com.au', toClient: false, deliberateClientSend: false })
    // never the client's live Approve page — it has no preview, so a press there would be the client's
    // answer (review fix of audit P4, 29 Sep 2026)
    const body = String(notify.mock.calls[0][0].bodyHtml)
    expect(body).toContain('/dashboard/production/item-1')
    expect(body).not.toContain('/portal/')
    expect(body).not.toContain('opens in preview')
    expect((fake.rows('content_items')[0] as unknown as { client_sent?: unknown }).client_sent).toBeUndefined()
  })

  it('whoever presses Send, the email is in Divina\'s name', async () => {
    fake = seed('client_review', 'tok-1', {
      team_users: [{ id: '54926a48-335e-46e9-a080-df8c1ad42ac9', name: 'Divina', email: 'divina@mdmmarketing.com.au', active_status: true }] as unknown as Row[],
    })
    await call('POST', { emails: ['jordan@example.com'] })
    expect(notify.mock.calls[0][0]).toMatchObject({ actorName: 'Divina', actorEmail: 'divina@mdmmarketing.com.au' })
    expect(String(notify.mock.calls[0][0].bodyHtml)).toContain('Divina has sent you')
  })
})

describe('a POST through the same door: the one writer does it', () => {
  const postRow = (stage: string, extra: Record<string, unknown> = {}) => ({
    id: 'p1', client_id: 'c1', item_id: 'item-1', source_item_id: 'item-1', created_by: 'u-sch',
    slides: [{ url: 'https://media.mdmmarketing.com.au/a.jpg', name: 'a.jpg', type: 'image' }],
    caption: 'Where it started.', channels: ['acc-ig'], per_channel: {}, timezone: 'Australia/Melbourne',
    scheduled_for: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    stage, rev: 3, draft_version: 2, sent_version: 1,
    ...extra,
  })
  const v1 = {
    id: 'p1_v1', post_id: 'p1', client_id: 'c1', n: 1, caption: 'Where it started.',
    slides: [{ url: 'https://media.mdmmarketing.com.au/a.jpg', name: 'a.jpg', type: 'image' }], channels: ['acc-ig'],
    timezone: 'Australia/Melbourne', frozen_for: 'quality_check', frozen_at: '2026-09-28T00:00:00Z',
  }
  const accounts = [{ id: 'acc-ig', client_id: 'c1', platform: 'instagram', provider_account_id: 'p', name: 'IG', active: true }]
  const passed = {
    qc_pass: { version: 1, by: 'u-qr', at: '2026-09-28T01:00:00Z' },
    approval: { version: 1, by: 'u-qr', hat: 'quality_reviewer', on_behalf_of_client: false, agreed_via: null, note: null, at: '2026-09-28T01:00:00Z' },
  }

  it('a passed post (Ready to post) goes to the client: frozen version emailed, then the post moves', async () => {
    fake = seed('approved_for_scheduling', 'tok-1', {
      social_posts: [postRow('ready', passed)] as unknown as Row[],
      post_versions: [v1] as unknown as Row[],
      social_accounts: accounts as unknown as Row[],
    })
    const r = await call('POST', { post_id: 'p1', expect_rev: 3, version: 1, emails: ['jordan@example.com'] })
    expect(r.status).toBe(200)
    expect(r.json.post).toMatchObject({ stage: 'with_client', client_send: { version: 1, to: ['jordan@example.com'] } })
    expect(notify).toHaveBeenCalledTimes(1)
    const sent = notify.mock.calls[0][0]
    expect(String(sent.subject)).toContain('Your post is ready to approve')
    expect(String(sent.bodyHtml)).toContain('/portal/tok-1/post/p1')
    expect(String(sent.bodyHtml)).toContain('Where it started.')
  })

  it('an account manager cannot pass a post out of the quality check to the client (decision 3)', async () => {
    fake = seed('approved_for_scheduling', 'tok-1', {
      social_posts: [postRow('quality_check')] as unknown as Row[],
      post_versions: [v1] as unknown as Row[],
      social_accounts: accounts as unknown as Row[],
    })
    const r = await call('POST', { post_id: 'p1', expect_rev: 3, version: 1, emails: ['jordan@example.com'] })
    expect(r.status).toBe(403)
    expect(notify).not.toHaveBeenCalled()
    expect((fake.rows('social_posts')[0] as unknown as { stage: string }).stage).toBe('quality_check')
  })

  it('nothing reached the client → nothing moved', async () => {
    fake = seed('approved_for_scheduling', 'tok-1', {
      social_posts: [postRow('ready', passed)] as unknown as Row[],
      post_versions: [v1] as unknown as Row[],
      social_accounts: accounts as unknown as Row[],
    })
    notify.mockImplementation(async () => 'failed')
    const r = await call('POST', { post_id: 'p1', expect_rev: 3, version: 1, emails: ['jordan@example.com'] })
    expect(r.status).toBe(409)
    expect(r.json.code).toBe('delivery')
    const row = fake.rows('social_posts')[0] as unknown as Record<string, unknown>
    expect(row.stage).toBe('ready')
    expect(row.client_send ?? null).toBeNull()
  })
})
