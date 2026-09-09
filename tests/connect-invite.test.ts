import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'

/**
 * THE EMAIL CARRIES THE PERMANENT LINK (9 Sep 2026).
 *
 * It used to carry the provider's own sign-in URL, which expires within the
 * hour — "if the button has expired by the time you press it, reply and
 * we'll send a fresh one". A client who opened it after lunch had a dead
 * button. It now carries /connect/<token>, which never expires and is the
 * same page they use months later when a connection runs out.
 */
const h = { user: { id: 'u-am', role: 'super_admin', email: 'am@x.invalid', name: 'Ava', clerk_user_id: null } }
vi.mock('../app/lib/authz', () => {
  class AuthzError extends Error {
    status: number
    constructor(message: string, status: number) { super(message); this.status = status }
  }
  return {
    AuthzError,
    authzErrorResponse: (e: unknown) => (e instanceof AuthzError
      ? { error: e.message, status: e.status }
      : { error: e instanceof Error ? e.message : 'error', status: 500 }),
    requireRole: async () => h.user,
    requireSignedIn: async () => h.user,
  }
})
const sent: { to: string; subject: string; html: string }[] = []
vi.mock('../app/lib/mailer', () => ({
  notify: vi.fn(async (i: { recipientEmail: string; subject: string; bodyHtml: string }) => {
    sent.push({ to: i.recipientEmail, subject: i.subject, html: i.bodyHtml })
    return 'sent'
  }),
  renderEmail: (subject: string, body: string, cta: string, href: string) => `${subject}|${body}|${cta}|${href}`,
  escapeHtml: (s: string) => s,
}))
vi.mock('../app/lib/social-schedule', () => ({ assertClientAccess: async () => {} }))

const TOKEN = '11111111-2222-4333-8444-555555555555'
let fake: ReturnType<typeof seedDb> | null = null
afterEach(() => { fake?.restore(); fake = null; sent.length = 0 })

const post = async (body: unknown) => {
  const route = await import('../app/api/social/connect/invite/route')
  const r = await route.POST(new Request('https://x.test', { method: 'POST', body: JSON.stringify(body) }))
  return { status: r.status, body: await r.json() }
}

describe('the invite email', () => {
  it('sends the permanent connect link with the ticked networks, to the portal login and the contact email', async () => {
    fake = seedDb({
      clients: [{ id: 'c1', name: 'Acme', share_token: TOKEN, email: 'owner@acme.example', contact_name: 'Sam' } as unknown as Row],
      team_users: [{ id: 'u-cl', role: 'client', client_id: 'c1', email: 'portal@acme.example', name: 'Pat', active_status: true } as unknown as Row],
    })
    const res = await post({ clientId: 'c1', networks: 'facebook,tiktok' })
    expect(res.status).toBe(200)
    expect(res.body.sent).toBe(2)
    expect(res.body.link).toMatch(new RegExp(`/connect/${TOKEN}\\?networks=facebook,tiktok$`))
    expect(sent.map(s => s.to).sort()).toEqual(['owner@acme.example', 'portal@acme.example'])
    expect(sent[0].subject).toBe('Connect your Facebook and TikTok accounts')
    // the button is the permanent page, never a provider URL
    expect(sent[0].html).toContain(`/connect/${TOKEN}?networks=facebook,tiktok`)
    expect(sent[0].html).not.toContain('oauth')
  })

  it('a reconnect ask names the network and points at Reconnect', async () => {
    fake = seedDb({
      clients: [{ id: 'c1', name: 'Acme', share_token: TOKEN, email: 'owner@acme.example' } as unknown as Row],
    })
    const res = await post({ clientId: 'c1', platform: 'tiktok', reason: 'reconnect' })
    expect(res.status).toBe(200)
    expect(sent[0].subject).toBe('Please reconnect your TikTok account')
    expect(sent[0].html).toContain('Reconnect')
    expect(sent[0].html).toContain(`/connect/${TOKEN}?networks=tiktok`)
  })

  it('mints a token for a client made before tokens existed, and keeps it', async () => {
    fake = seedDb({
      clients: [{ id: 'c1', name: 'Acme', share_token: null, email: 'owner@acme.example' } as unknown as Row],
    })
    const res = await post({ clientId: 'c1', networks: 'instagram' })
    expect(res.status).toBe(200)
    const stored = (fake.rows('clients')[0] as unknown as { share_token: string }).share_token
    expect(stored).toMatch(/^[0-9a-f-]{36}$/)
    expect(res.body.link).toContain(`/connect/${stored}`)
  })

  it('says so, in words, when there is nobody to email', async () => {
    fake = seedDb({ clients: [{ id: 'c1', name: 'Acme', share_token: TOKEN, email: null } as unknown as Row] })
    const res = await post({ clientId: 'c1', networks: 'instagram' })
    expect(res.status).toBe(400)
    expect(String(res.body.error)).toContain('no email on record')
    expect(sent).toHaveLength(0)
  })
})
