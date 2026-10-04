import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import { NextRequest } from 'next/server'
import { seedDb } from './helpers/fake-db'
import { signState } from '../app/lib/meta-ig-core'
import type { Row } from '@/lib/db-types'

/**
 * The agency's own Instagram Login, at its routes (1 Oct 2026): the webhook,
 * the callback, the connect, the daily refresh and publish — against the real
 * lib/db on the in-memory RTDB, with every Meta call answered by a mock.
 * Nothing here reaches Instagram.
 */

class AuthzError extends Error { constructor(m: string, public status: number) { super(m) } }
let who: { id: string; role: string } | null = null
vi.mock('../app/lib/authz', () => ({
  AuthzError,
  requireRole: async (required: string) => {
    if (!who) throw new AuthzError('Not signed in', 401)
    const rank = ['scheduler', 'editor', 'quality_checker', 'general', 'account_manager', 'super_admin']
    if (who.role !== 'super_admin' && rank.indexOf(who.role) < rank.indexOf(required)) throw new AuthzError('Insufficient permissions', 403)
    return { ...who, active_status: true }
  },
  guard: async () => null,
  authzErrorResponse: (e: unknown) => e instanceof AuthzError ? { error: e.message, status: e.status } : { error: String(e), status: 500 },
}))
// nothing on this road may send mail
vi.mock('../app/lib/mailer', () => { throw new Error('the Instagram Login must not send email') })

const SECRET = 'ig-app-secret'
const VERIFY = 'verify-me'

/** Meta's side: every call recorded, answered by `answer`. */
type MetaCall = { method: string; url: URL; body: string }
let metaCalls: MetaCall[] = []
let answer: (c: MetaCall) => unknown = () => ({})
const metaFetch = (async (input: any, init: any = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url)
  const c = { method: (init.method ?? 'GET').toUpperCase(), url, body: typeof init.body === 'string' ? init.body : '' }
  metaCalls.push(c)
  const out = answer(c)
  const status = (out as any)?.__status ?? 200
  return new Response(JSON.stringify(out), { status, headers: { 'content-type': 'application/json' } })
}) as typeof fetch

let fake: ReturnType<typeof seedDb>
const original = globalThis.fetch
function setup(seed: Record<string, Row[]> = {}) {
  globalThis.fetch = metaFetch
  fake = seedDb({ clients: [{ id: 'c1', name: '100M' } as Row], ...seed })
}

beforeEach(() => {
  metaCalls = []
  answer = () => ({})
  who = null
  vi.stubEnv('META_IG_APP_SECRET', SECRET)
  vi.stubEnv('META_WEBHOOK_VERIFY_TOKEN', VERIFY)
  vi.stubEnv('CREDENTIALS_KEY', 'test-credentials-key')
  vi.stubEnv('META_IG_APP_ID', '')
  vi.stubEnv('META_IG_REDIRECT_URI', '')
})
afterEach(() => {
  fake?.restore()
  globalThis.fetch = original
  vi.unstubAllEnvs()
})

/* ── the webhook ─────────────────────────────────────────────────────── */

const signBody = (raw: string, secret = SECRET) => 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex')
const hookPost = (raw: string, sig: string | null) => new NextRequest('https://app.mdmmarketing.com.au/api/meta/webhook', {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(sig ? { 'x-hub-signature-256': sig } : {}) },
  body: raw,
})

describe('GET /api/meta/webhook — the handshake', () => {
  it('echoes the challenge for subscribe + the right token, and nothing else', async () => {
    const { GET } = await import('../app/api/meta/webhook/route')
    const ask = (q: string) => GET(new NextRequest(`https://app.mdmmarketing.com.au/api/meta/webhook?${q}`))
    const ok = await ask('hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=1158201444')
    expect(ok.status).toBe(200)
    expect(await ok.text()).toBe('1158201444')
    expect((await ask('hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1')).status).toBe(403)
    expect((await ask('hub.mode=other&hub.verify_token=verify-me&hub.challenge=1')).status).toBe(403)
  })

  it('503 while the verify token is unset', async () => {
    vi.stubEnv('META_WEBHOOK_VERIFY_TOKEN', '')
    const { GET } = await import('../app/api/meta/webhook/route')
    const res = await GET(new NextRequest('https://app.mdmmarketing.com.au/api/meta/webhook?hub.mode=subscribe&hub.verify_token=&hub.challenge=1'))
    expect(res.status).toBe(503)
  })
})

describe('POST /api/meta/webhook', () => {
  const body = JSON.stringify({
    object: 'instagram',
    entry: [{
      id: '1789', time: 1759280000,
      changes: [{ field: 'comments', value: { id: 'cm1', text: 'price?', from: { id: 'p1', username: 'pat' }, media: { id: 'm1' } } }],
      messaging: [{ sender: { id: 'p1' }, recipient: { id: '1789' }, timestamp: 1759280000123, message: { mid: 'mid1', text: 'hello' } }],
    }],
  })

  it('refuses a bad signature and records nothing', async () => {
    setup()
    const { POST } = await import('../app/api/meta/webhook/route')
    expect((await POST(hookPost(body, signBody(body, 'wrong')))).status).toBe(401)
    expect((await POST(hookPost(body, null))).status).toBe(401)
    expect(fake.rows('webhook_deliveries')).toEqual([])
    expect(fake.rows('meta_ig_events')).toEqual([])
  })

  it('records a good delivery once, stores the comment and the message, and calls nobody', async () => {
    setup({ meta_ig_accounts: [{ id: '1789', client_id: 'c1', status: 'active' } as Row] })
    const { POST } = await import('../app/api/meta/webhook/route')
    const first = await POST(hookPost(body, signBody(body)))
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ ok: true, stored: 2 })

    const again = await POST(hookPost(body, signBody(body)))
    expect(again.status).toBe(200)
    expect(await again.json()).toEqual({ ok: true, duplicate: true })

    const deliveries = fake.rows('webhook_deliveries') as any[]
    expect(deliveries).toHaveLength(1)
    expect(deliveries[0]).toMatchObject({ provider: 'meta_ig', event: 'instagram', handled: true })
    const events = fake.rows('meta_ig_events') as any[]
    expect(events.map(e => e.kind).sort()).toEqual(['comments', 'messages'])
    expect(events.every(e => e.client_id === 'c1' && e.ig_user_id === '1789')).toBe(true)
    // not one call went to Meta: nothing replies on its own
    expect(metaCalls).toEqual([])
  })

  it('503 while the app secret is unset', async () => {
    vi.stubEnv('META_IG_APP_SECRET', '')
    const { POST } = await import('../app/api/meta/webhook/route')
    expect((await POST(hookPost(body, signBody(body)))).status).toBe(503)
  })
})

/* ── the login ───────────────────────────────────────────────────────── */

const LONG_TOKEN = 'IGAA-long-lived-token-value'
function metaLogin(c: MetaCall): unknown {
  if (c.url.host === 'api.instagram.com' && c.url.pathname === '/oauth/access_token') {
    return { data: [{ access_token: 'IGAA-short', user_id: '1789', permissions: 'instagram_business_basic,instagram_business_manage_comments' }] }
  }
  if (c.url.pathname === '/access_token') return { access_token: LONG_TOKEN, token_type: 'bearer', expires_in: 5184000 }
  if (c.url.pathname.endsWith('/me')) return { user_id: '1789', username: 'hundredm', account_type: 'BUSINESS' }
  return { __status: 404, error: { message: 'unexpected call' } }
}

describe('GET /api/meta/instagram/callback', () => {
  const cb = (q: string) => new NextRequest(`https://app.mdmmarketing.com.au/api/meta/instagram/callback?${q}`)

  it('stores ONE row, encrypted, and sends the person back to the client', async () => {
    setup()
    answer = metaLogin
    const { GET } = await import('../app/api/meta/instagram/callback/route')
    const state = signState({ clientId: 'c1', userId: 'tu-1', now: Date.now() }, SECRET)
    const res = await GET(cb(`code=abc%23_&state=${encodeURIComponent(state)}`))
    expect(res.status).toBe(302)
    const to = new URL(res.headers.get('location')!)
    expect(to.pathname).toBe('/dashboard/clients/c1/social')
    expect(to.searchParams.get('meta_ig')).toBe('connected')
    expect(to.searchParams.get('username')).toBe('hundredm')
    expect(res.headers.get('location')).not.toContain('IGAA')

    // the code went to Instagram without its "#_", with the secret, as a form POST
    const exchange = metaCalls[0]
    expect(exchange.method).toBe('POST')
    expect(new URLSearchParams(exchange.body).get('code')).toBe('abc')
    expect(new URLSearchParams(exchange.body).get('redirect_uri')).toBe('https://app.mdmmarketing.com.au/api/meta/instagram/callback')

    const rows = fake.rows('meta_ig_accounts') as any[]
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: '1789', client_id: 'c1', username: 'hundredm', connected_by: 'tu-1', status: 'active' })
    expect(rows[0].scopes).toEqual(['instagram_business_basic', 'instagram_business_manage_comments'])
    expect(JSON.stringify(rows[0])).not.toContain(LONG_TOKEN)
    const { decryptSecret } = await import('../app/lib/secret-box')
    expect(decryptSecret(rows[0].access_token_encrypted)).toBe(LONG_TOKEN)
    expect(Date.parse(rows[0].token_expires_at) - Date.now()).toBeGreaterThan(59 * 24 * 3600 * 1000)

    // connecting the same account again is the same row
    const state2 = signState({ clientId: 'c1', userId: 'tu-2', now: Date.now() }, SECRET)
    await GET(cb(`code=def&state=${encodeURIComponent(state2)}`))
    const after = fake.rows('meta_ig_accounts') as any[]
    expect(after).toHaveLength(1)
    expect(after[0]).toMatchObject({ connected_by: 'tu-2', connected_at: rows[0].connected_at })
  })

  it('refuses a forged or expired state, and stores nothing', async () => {
    setup()
    answer = metaLogin
    const { GET } = await import('../app/api/meta/instagram/callback/route')
    const forged = signState({ clientId: 'c1', userId: 'tu-1', now: Date.now() }, 'not-the-secret')
    expect((await GET(cb(`code=a&state=${encodeURIComponent(forged)}`))).status).toBe(400)
    const old = signState({ clientId: 'c1', userId: 'tu-1', now: Date.now() - 11 * 60 * 1000 }, SECRET)
    expect((await GET(cb(`code=a&state=${encodeURIComponent(old)}`))).status).toBe(400)
    expect(metaCalls).toEqual([])
    expect(fake.rows('meta_ig_accounts')).toEqual([])
  })

  it('a refusal on Instagram\'s screen comes back as denied', async () => {
    setup()
    const { GET } = await import('../app/api/meta/instagram/callback/route')
    const state = signState({ clientId: 'c1', userId: 'tu-1', now: Date.now() }, SECRET)
    const res = await GET(cb(`error=access_denied&state=${encodeURIComponent(state)}`))
    expect(new URL(res.headers.get('location')!).searchParams.get('meta_ig')).toBe('denied')
  })

  it('503 with the reason while unconfigured', async () => {
    vi.stubEnv('META_IG_APP_SECRET', '')
    const { GET } = await import('../app/api/meta/instagram/callback/route')
    const res = await GET(cb('code=a&state=b'))
    expect(res.status).toBe(503)
    expect(await res.text()).toMatch(/META_IG_APP_SECRET/)
  })
})

describe('GET /api/meta/instagram/connect', () => {
  const go = (q: string) => new NextRequest(`https://app.mdmmarketing.com.au/api/meta/instagram/connect?${q}`)

  it('sends an account manager to Instagram with a signed state for THEIR client', async () => {
    setup({ team_user_clients: [{ id: 'l1', team_user_id: 'tu-am', client_id: 'c1' } as Row] })
    who = { id: 'tu-am', role: 'account_manager' }
    const { GET } = await import('../app/api/meta/instagram/connect/route')
    const res = await GET(go('clientId=c1'))
    expect(res.status).toBe(302)
    const to = new URL(res.headers.get('location')!)
    expect(to.origin + to.pathname).toBe('https://www.instagram.com/oauth/authorize')
    expect(to.searchParams.get('client_id')).toBe('843035665085991')
    const { verifyState } = await import('../app/lib/meta-ig-core')
    const st = verifyState(to.searchParams.get('state'), SECRET, Date.now())
    expect(st.ok && st.payload).toMatchObject({ clientId: 'c1', userId: 'tu-am' })
  })

  it('refuses an account manager who is not on that client (5 Oct 2026: the reviewer account is 100M-only)', async () => {
    setup()
    who = { id: 'tu-other', role: 'account_manager' }
    const { GET } = await import('../app/api/meta/instagram/connect/route')
    const res = await GET(go('clientId=c1'))
    expect(res.status).toBe(403)
  })

  it('refuses an editor and a stranger; 404s an unknown client', async () => {
    setup()
    const { GET } = await import('../app/api/meta/instagram/connect/route')
    who = { id: 'tu-ed', role: 'editor' }
    expect((await GET(go('clientId=c1'))).status).toBe(403)
    who = null
    expect((await GET(go('clientId=c1'))).status).toBe(401)
    who = { id: 'tu-sa', role: 'super_admin' }
    expect((await GET(go('clientId=nope'))).status).toBe(404)
  })

  it('503 while unconfigured', async () => {
    vi.stubEnv('META_IG_APP_SECRET', '')
    who = { id: 'tu-sa', role: 'super_admin' }
    const { GET } = await import('../app/api/meta/instagram/connect/route')
    expect((await GET(go('clientId=c1'))).status).toBe(503)
  })
})

/* ── the daily refresh, and publish (mocked) ─────────────────────────── */

describe('refreshDueTokens', () => {
  it('refreshes the due one, marks a refused one expired, leaves a fresh one', async () => {
    const { encryptSecret, decryptSecret } = await import('../app/lib/secret-box')
    const now = Date.now()
    const day = 24 * 3600 * 1000
    const base = { client_id: 'c1', username: null, account_type: null, scopes: ['x'], connected_by: 'tu', refreshed_at: null, last_error: null, status: 'active', connected_at: new Date(now - 50 * day).toISOString() }
    setup({
      meta_ig_accounts: [
        { ...base, id: 'due', access_token_encrypted: encryptSecret('tok-due'), token_expires_at: new Date(now + 5 * day).toISOString() },
        { ...base, id: 'refused', access_token_encrypted: encryptSecret('tok-bad'), token_expires_at: new Date(now + 5 * day).toISOString() },
        { ...base, id: 'far', access_token_encrypted: encryptSecret('tok-far'), token_expires_at: new Date(now + 50 * day).toISOString() },
      ] as unknown as Row[],
    })
    answer = c => c.url.searchParams.get('access_token') === 'tok-due'
      ? { access_token: 'tok-new', expires_in: 5184000 }
      : { __status: 400, error: { message: 'Error validating access token', code: 190 } }
    const { refreshDueTokens } = await import('../app/lib/meta-ig')
    expect(await refreshDueTokens(now)).toEqual({ refreshed: 1, expired: 0, failed: 1 })
    expect(metaCalls.map(c => c.url.pathname)).toEqual(['/refresh_access_token', '/refresh_access_token'])
    const rows = Object.fromEntries((fake.rows('meta_ig_accounts') as any[]).map(r => [r.id, r]))
    expect(decryptSecret(rows.due.access_token_encrypted)).toBe('tok-new')
    expect(rows.due.status).toBe('active')
    expect(rows.refused).toMatchObject({ status: 'expired', last_error: 'Error validating access token (code 190)' })
    expect(rows.far.status).toBe('active')
  })

  it('does nothing while unconfigured', async () => {
    vi.stubEnv('META_IG_APP_SECRET', '')
    const { refreshDueTokens } = await import('../app/lib/meta-ig')
    expect((await refreshDueTokens(Date.now())).skipped).toMatch(/META_IG_APP_SECRET/)
    expect(metaCalls).toEqual([])
  })
})

describe('publish (mocked Meta, never a real account)', () => {
  it('reads the quota first, then container → media_publish', async () => {
    setup()
    answer = c => {
      if (c.url.pathname.endsWith('/content_publishing_limit')) return { data: [{ quota_usage: 1, config: { quota_total: 100 } }] }
      if (c.url.pathname.endsWith('/1789/media')) return { id: 'container-1' }
      if (c.url.pathname.endsWith('/1789/media_publish')) return { id: 'media-9' }
      return { __status: 404, error: { message: 'unexpected' } }
    }
    const { publish } = await import('../app/lib/meta-ig-client')
    expect(await publish('T', '1789', { kind: 'IMAGE', imageUrl: 'https://cdn.example/a.jpg', caption: 'hi' }))
      .toEqual({ mediaId: 'media-9' })
    expect(metaCalls.map(c => `${c.method} ${c.url.pathname}`)).toEqual([
      'GET /v23.0/1789/content_publishing_limit',
      'POST /v23.0/1789/media',
      'POST /v23.0/1789/media_publish',
    ])
    expect(new URLSearchParams(metaCalls[2].body).get('creation_id')).toBe('container-1')
  })

  it('a full quota refuses before anything is created', async () => {
    setup()
    answer = () => ({ data: [{ quota_usage: 100, config: { quota_total: 100 } }] })
    const { publish } = await import('../app/lib/meta-ig-client')
    await expect(publish('T', '1789', { kind: 'IMAGE', imageUrl: 'u' })).rejects.toThrow(/limit is reached/)
    expect(metaCalls).toHaveLength(1)
  })

  it('a reel waits for the container to finish', async () => {
    setup()
    let polls = 0
    answer = c => {
      if (c.url.pathname.endsWith('/content_publishing_limit')) return { data: [{ quota_usage: 0, config: { quota_total: 100 } }] }
      if (c.url.pathname.endsWith('/media')) return { id: 'ct' }
      if (c.url.pathname.endsWith('/ct')) return { status_code: ++polls < 2 ? 'IN_PROGRESS' : 'FINISHED' }
      if (c.url.pathname.endsWith('/media_publish')) return { id: 'reel-1' }
      return { __status: 404, error: { message: 'unexpected' } }
    }
    const { publish } = await import('../app/lib/meta-ig-client')
    expect(await publish('T', '1789', { kind: 'REELS', videoUrl: 'https://cdn.example/v.mp4' }, { delayMs: 0 }))
      .toEqual({ mediaId: 'reel-1' })
    expect(polls).toBe(2)
  })
})

describe('comments and messages (mocked Meta)', () => {
  it('reply, hide, private reply, and HUMAN_AGENT only behind the switch', async () => {
    setup()
    answer = c => c.url.pathname.endsWith('/messages') ? { recipient_id: 'p', message_id: 'mid' } : { id: 'r1', success: true }
    const client = await import('../app/lib/meta-ig-client')
    expect(await client.replyToComment('T', 'cm1', 'thanks')).toEqual({ id: 'r1' })
    expect(await client.hideComment('T', 'cm1', true)).toEqual({ ok: true })
    expect(await client.privateReply('T', 'cm1', 'hi')).toEqual({ messageId: 'mid' })
    await client.sendMessage('T', 'p', 'hi', { humanAgent: true })
    await client.sendMessage('T', 'p', 'hi', { humanAgent: true, allowHumanAgent: true })
    expect(metaCalls.map(c => `${c.method} ${c.url.pathname}`)).toEqual([
      'POST /v23.0/cm1/replies', 'POST /v23.0/cm1', 'POST /v23.0/me/messages', 'POST /v23.0/me/messages', 'POST /v23.0/me/messages',
    ])
    expect(JSON.parse(metaCalls[2].body)).toEqual({ recipient: { comment_id: 'cm1' }, message: { text: 'hi' } })
    expect(JSON.parse(metaCalls[3].body).tag).toBeUndefined()
    expect(JSON.parse(metaCalls[4].body).tag).toBe('HUMAN_AGENT')
  })

  it('an error never carries the token', async () => {
    setup()
    answer = () => ({ __status: 400, error: { message: 'Invalid OAuth access token', code: 190 } })
    const client = await import('../app/lib/meta-ig-client')
    const err = await client.getMe('SECRET-TOKEN-VALUE').then(() => new Error('resolved'), (e: Error) => e)
    expect(err.message).toBe('Invalid OAuth access token (code 190)')
    expect(err.message).not.toContain('SECRET-TOKEN-VALUE')
  })
})
