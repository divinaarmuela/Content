import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { seedDb } from './helpers/fake-db'
import { signMdAppState } from '../app/lib/md-app-core'
import { encryptSecret } from '../app/lib/secret-box'
import type { Row } from '@/lib/db-types'

/**
 * MD App at its routes (6 Nov 2026) — in-memory RTDB, every Meta call answered by a mock. Nothing reaches
 * Meta, nothing writes the live database, nobody is emailed.
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
vi.mock('../app/lib/production-access', () => ({ accessibleClientIds: async (u: { role: string }) => u.role === 'super_admin' ? null : ['c1'] }))
vi.mock('../app/lib/mailer', () => { throw new Error('MD App must not send email') })

const MD_SECRET = 'md-app-secret'
const TOKEN = 'EAAbisutokenbisutokenbisutoken'
type MetaCall = { method: string; url: URL; body: string }
let calls: MetaCall[] = []
let answer: (c: MetaCall) => unknown = () => ({})
let status: (c: MetaCall) => number = () => 200
const metaFetch = (async (input: any, init: any = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url)
  const c = { method: (init.method ?? 'GET').toUpperCase(), url, body: typeof init.body === 'string' ? init.body : '' }
  calls.push(c)
  return new Response(JSON.stringify(answer(c)), { status: status(c), headers: { 'content-type': 'application/json' } })
}) as typeof fetch

let fake: ReturnType<typeof seedDb>
const original = globalThis.fetch
function setup(seed: Record<string, Row[]> = {}) {
  globalThis.fetch = metaFetch
  fake = seedDb({ clients: [{ id: 'c1', name: 'ZZ TEST one' } as Row, { id: 'c2', name: 'ZZ TEST two' } as Row], ...seed })
}
const connected = (extra: Record<string, unknown> = {}) => ({
  md_app_connections: [{ id: 'c1', client_id: 'c1', business_id: null, token_encrypted: encryptSecret(TOKEN), connected_by: 'u', connected_at: '2026-11-06T00:00:00Z', active: true, use_md_app: false, last_error: null, ...extra } as Row],
  md_app_assets: [
    { id: 'c1__instagram__17', client_id: 'c1', kind: 'instagram', asset_id: '17', name: 'zz', picked: true, seen_at: 'x' } as Row,
    { id: 'c1__page__55', client_id: 'c1', kind: 'page', asset_id: '55', name: 'Page', picked: true, seen_at: 'x' } as Row,
  ],
})
beforeEach(() => {
  calls = []; answer = () => ({}); status = () => 200; who = null
  vi.stubEnv('MD_SECRET', MD_SECRET)
  vi.stubEnv('CREDENTIALS_KEY', 'test-credentials-key')
  vi.stubEnv('MD_APP_ID', ''); vi.stubEnv('MD_APP_CONFIG_ID', ''); vi.stubEnv('MD_APP_REDIRECT_URI', '')
  vi.stubEnv('MD_APP_WEBHOOK_VERIFY_TOKEN', 'md-verify')
  vi.stubEnv('META_APP_SECRET', ''); vi.stubEnv('META_IG_APP_SECRET', ''); vi.stubEnv('META_WEBHOOK_VERIFY_TOKEN', '')
})
afterEach(() => { fake?.restore(); globalThis.fetch = original; vi.unstubAllEnvs() })

describe('middleware', () => {
  const src = readFileSync(join(__dirname, '..', 'middleware.ts'), 'utf8')
  const protectedBlock = src.slice(src.indexOf('createRouteMatcher(['), src.indexOf('])', src.indexOf('createRouteMatcher([')))
  const matcherBlock = src.slice(src.indexOf('matcher: ['))
  const entries = (b: string) => [...b.matchAll(/'(\/[^']+)'/g)].map(m => m[1])
  const covers = (pattern: string, path: string) => new RegExp('^' + pattern.replace(/\/:path\*$/, '(/.*)?').replace(/\(\.\*\)/g, '.*') + '$').test(path)
  it('gates every MD App route; the shared callback and the webhook stay public', () => {
    for (const p of ['/api/meta/md-app', '/api/meta/md-app/connect', '/api/meta/md-app/test']) {
      expect(entries(protectedBlock).some(e => covers(e, p)), p).toBe(true)
      expect(entries(matcherBlock).some(e => covers(e, p)), p).toBe(true)
    }
    for (const p of ['/api/meta/facebook/callback', '/api/meta/webhook']) {
      expect(entries(protectedBlock).filter(e => covers(e, p))).toEqual([])
    }
    const cb = readFileSync(join(__dirname, '..', 'app/lib/md-app-callback.ts'), 'utf8')
    expect(cb).not.toMatch(/\b(requireRole|requireSignedIn|guard|resolveTeamUser|auth)\s*\(/)
  })
})

describe('GET /api/meta/md-app/connect', () => {
  const go = async (q: string) => (await import('../app/api/meta/md-app/connect/route')).GET(new NextRequest(`https://app.mdmmarketing.com.au/api/meta/md-app/connect?${q}`))
  it('401 signed out, 403 below account manager, 403 not their client', async () => {
    setup()
    expect((await go('clientId=c1')).status).toBe(401)
    who = { id: 'u', role: 'editor' }; expect((await go('clientId=c1')).status).toBe(403)
    who = { id: 'u', role: 'account_manager' }; expect((await go('clientId=c2')).status).toBe(403)
  })
  it('503 with a plain reason until MD_SECRET is set', async () => {
    setup(); vi.stubEnv('MD_SECRET', ''); who = { id: 'u', role: 'super_admin' }
    const res = await go('clientId=c1')
    expect(res.status).toBe(503)
    expect((await res.json()).error).toMatch(/MD_SECRET/)
  })
  it('redirects to the dialog with config_id and an MD App state', async () => {
    setup(); who = { id: 'u', role: 'account_manager' }
    const res = await go('clientId=c1')
    expect(res.status).toBe(302)
    const u = new URL(res.headers.get('location')!)
    expect(u.searchParams.get('config_id')).toBe('1439306511741893')
    expect(u.searchParams.get('client_id')).toBe('2326339324873915')
    expect(u.searchParams.get('redirect_uri')).toBe('https://app.mdmmarketing.com.au/api/meta/facebook/callback')
    expect(u.searchParams.get('state')!.startsWith('mdapp1.')).toBe(true)
    expect(u.searchParams.has('scope')).toBe(false)
  })
})

describe('the shared callback, MD App half', () => {
  const go = async (q: string) => (await import('../app/api/meta/facebook/callback/route')).GET(new NextRequest(`https://app.mdmmarketing.com.au/api/meta/facebook/callback?${q}`))
  it('code → encrypted BISU token + assigned accounts; nothing leaks', async () => {
    setup()
    answer = c => {
      const p = c.url.pathname
      if (p.endsWith('/oauth/access_token')) return { access_token: TOKEN, token_type: 'bearer' }
      if (p.endsWith('/me/assigned_instagram_accounts')) return { data: [{ id: '17', username: 'zz' }] }
      if (p.endsWith('/me/accounts')) return { data: [{ id: '55', name: 'Page' }] }
      if (p.endsWith('/me/adaccounts')) return { data: [{ id: 'act_9', account_id: '9', name: 'Ads' }] }
      if (p.endsWith('/me')) return { client_business_id: '777', id: '1' }
      return {}
    }
    const state = signMdAppState({ clientId: 'c1', userId: 'u1', now: Date.now() }, MD_SECRET)
    const res = await go(`code=abc&state=${encodeURIComponent(state)}`)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('md_app=connected')
    expect(calls.every(c => c.url.host === 'graph.facebook.com' && c.url.pathname.startsWith('/v27.0/'))).toBe(true)
    const conn = fake.rows('md_app_connections')[0] as any
    expect(conn).toMatchObject({ client_id: 'c1', business_id: '777', active: true, use_md_app: false })
    expect(JSON.stringify(fake.rows('md_app_connections'))).not.toContain(TOKEN)
    // act_9 is not our own ad account, so it is never stored (allowedAdAccounts, 9 Nov 2026)
    expect(fake.rows('md_app_assets').map((r: any) => r.id).sort()).toEqual(['c1__instagram__17', 'c1__page__55'])
    expect(fake.rows('md_app_assets').every((r: any) => r.picked === false)).toBe(true)
    expect(res.headers.get('location')).not.toContain(TOKEN)
  })
  it('a bad MD App state is refused; the old Facebook road is untouched for other states', async () => {
    setup()
    const res = await go('code=abc&state=mdapp1.xxx.yyy')
    expect(res.status).toBe(400)
    expect(calls).toEqual([])
  })
})

describe('/api/meta/md-app', () => {
  const route = () => import('../app/api/meta/md-app/route')
  const post = async (body: unknown) => (await route()).POST(new NextRequest('https://app.mdmmarketing.com.au/api/meta/md-app', { method: 'POST', body: JSON.stringify(body) }))
  it('GET never returns a token', async () => {
    setup(connected()); who = { id: 'u', role: 'account_manager' }
    const res = await (await route()).GET(new NextRequest('https://app.mdmmarketing.com.au/api/meta/md-app?clientId=c1'))
    const text = await res.text()
    expect(res.status).toBe(200)
    expect(text).not.toContain('token_encrypted'); expect(text).not.toContain(TOKEN)
    expect(JSON.parse(text)).toMatchObject({ configured: true, usesMdApp: false })
  })
  it('POST is super admin only; the switch needs a connection and never touches the clients row', async () => {
    setup(); who = { id: 'u', role: 'account_manager' }
    expect((await post({ clientId: 'c1', action: 'use', on: true })).status).toBe(403)
    who = { id: 'u', role: 'super_admin' }
    expect((await post({ clientId: 'c1', action: 'use', on: true })).status).toBe(409)
    fake.restore(); setup(connected())
    expect((await post({ clientId: 'c1', action: 'use', on: true })).status).toBe(200)
    expect((fake.rows('md_app_connections')[0] as any).use_md_app).toBe(true)
    expect(fake.rows('clients').find((c: any) => c.id === 'c1')).toEqual({ id: 'c1', name: 'ZZ TEST one' })
    expect((await post({ clientId: 'c1', action: 'unpick', kind: 'page', assetId: '55' })).status).toBe(200)
    expect((await post({ clientId: 'c1', action: 'pick', kind: 'page', assetId: '../x' })).status).toBe(400)
    expect((await post({ clientId: 'c2', action: 'pick', kind: 'page', assetId: '55' })).status).toBe(404)
  })
})

describe('POST /api/meta/md-app/test', () => {
  const go = async (body: unknown) => (await import('../app/api/meta/md-app/test/route')).POST(new NextRequest('https://app.mdmmarketing.com.au/api/meta/md-app/test', { method: 'POST', body: JSON.stringify(body) }))
  it('super admin only; one real call; answers a summary only', async () => {
    setup(connected()); who = { id: 'u', role: 'account_manager' }
    expect((await go({ clientId: 'c1', test: 'ig_profile' })).status).toBe(403)
    who = { id: 'u', role: 'super_admin' }
    expect((await go({ clientId: 'c1', test: 'nope' })).status).toBe(400)
    answer = () => ({ id: '17', username: 'zz', access_token: 'EAAleakleakleakleak' })
    const res = await go({ clientId: 'c1', test: 'ig_profile' })
    const text = await res.text()
    expect(res.status).toBe(200)
    expect(calls).toHaveLength(1)
    expect(calls[0].url.pathname).toBe('/v27.0/17')
    expect(calls[0].url.searchParams.get('appsecret_proof')).toMatch(/^[a-f0-9]{64}$/)
    expect(text).not.toContain('EAA')
  })
  it('409 when not connected', async () => {
    setup(); who = { id: 'u', role: 'super_admin' }
    expect((await go({ clientId: 'c1', test: 'ig_profile' })).status).toBe(409)
  })
})

describe('webhook: MD App signature → md_app_events only', () => {
  const sign = (raw: string, s: string) => 'sha256=' + createHmac('sha256', s).update(raw).digest('hex')
  const route = () => import('../app/api/meta/webhook/route')
  it('GET verify accepts MD_APP_WEBHOOK_VERIFY_TOKEN', async () => {
    setup()
    const res = await (await route()).GET(new NextRequest('https://app.mdmmarketing.com.au/api/meta/webhook?hub.mode=subscribe&hub.verify_token=md-verify&hub.challenge=42'))
    expect(res.status).toBe(200); expect(await res.text()).toBe('42')
    const bad = await (await route()).GET(new NextRequest('https://app.mdmmarketing.com.au/api/meta/webhook?hub.mode=subscribe&hub.verify_token=no&hub.challenge=42'))
    expect(bad.status).toBe(403)
  })
  it('stores once, owned by the picked account; never in the old tables', async () => {
    setup(connected())
    const raw = JSON.stringify({ object: 'instagram', entry: [{ id: '17', time: 1_700_000_000, changes: [{ field: 'comments', value: { id: 'cm1', text: 'hi' } }] }] })
    const send = async () => (await route()).POST(new NextRequest('https://app.mdmmarketing.com.au/api/meta/webhook', { method: 'POST', body: raw, headers: { 'x-hub-signature-256': sign(raw, MD_SECRET) } }))
    expect((await send()).status).toBe(200)
    expect((await send()).status).toBe(200)
    const rows = fake.rows('md_app_events') as any[]
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ object: 'instagram', account_id: '17', client_id: 'c1', field: 'comments' })
    expect(fake.rows('meta_ig_events')).toEqual([]); expect(fake.rows('meta_fb_events')).toEqual([])
    const wrong = await (await route()).POST(new NextRequest('https://app.mdmmarketing.com.au/api/meta/webhook', { method: 'POST', body: raw, headers: { 'x-hub-signature-256': sign(raw, 'nope') } }))
    expect(wrong.status).toBe(401)
  })
})

describe('mdPublish: never twice', () => {
  it('publishes an Instagram picture once; a repeat finds it done', async () => {
    setup(connected())
    answer = c => {
      if (c.method === 'POST' && c.url.pathname.endsWith('/17/media')) return { id: 'cont1' }
      if (c.url.pathname.endsWith('/cont1')) return { status_code: 'FINISHED' }
      if (c.url.pathname.endsWith('/17/media_publish')) return { id: 'media1' }
      return {}
    }
    const { mdPublish } = await import('../app/lib/md-app')
    const input = { id: 'p1', clientId: 'c1', request: { network: 'instagram' as const, req: { kind: 'IMAGE' as const, imageUrl: 'https://x/a.jpg' } }, now: Date.now(), pollDelayMs: 0 }
    expect(await mdPublish(input)).toEqual({ kind: 'published', postId: 'media1' })
    expect(await mdPublish(input)).toEqual({ kind: 'published', postId: 'media1' })
    expect(calls.filter(c => c.url.pathname.endsWith('/media_publish'))).toHaveLength(1)
  })
  it('a lost answer keeps the mark: the retry does not post again', async () => {
    setup(connected())
    answer = c => {
      if (c.method === 'POST' && c.url.pathname.endsWith('/17/media')) return { id: 'cont1' }
      if (c.url.pathname.endsWith('/cont1')) return { status_code: 'FINISHED' }
      return {}
    }
    status = c => c.url.pathname.endsWith('/media_publish') ? 502 : 200
    const { mdPublish } = await import('../app/lib/md-app')
    const input = { id: 'p2', clientId: 'c1', request: { network: 'instagram' as const, req: { kind: 'IMAGE' as const, imageUrl: 'https://x/a.jpg' } }, now: Date.now(), pollDelayMs: 0 }
    expect((await mdPublish(input)).kind).toBe('unknown')
    status = () => 200
    expect((await mdPublish(input)).kind).toBe('unknown')
    expect(calls.filter(c => c.url.pathname.endsWith('/media_publish'))).toHaveLength(1)
  })
  it('a Meta refusal lifts the mark so it may be tried again', async () => {
    setup(connected())
    answer = c => {
      if (c.method === 'POST' && c.url.pathname.endsWith('/17/media')) return { id: 'cont1' }
      if (c.url.pathname.endsWith('/cont1')) return { status_code: 'FINISHED' }
      if (c.url.pathname.endsWith('/media_publish')) return { error: { message: 'nope', code: 100 } }
      return {}
    }
    status = c => c.url.pathname.endsWith('/media_publish') ? 400 : 200
    const { mdPublish } = await import('../app/lib/md-app')
    const input = { id: 'p3', clientId: 'c1', request: { network: 'instagram' as const, req: { kind: 'IMAGE' as const, imageUrl: 'https://x/a.jpg' } }, now: Date.now(), pollDelayMs: 0 }
    expect((await mdPublish(input)).kind).toBe('refused')
    expect((fake.rows('md_app_publishes')[0] as any).sending_at ?? null).toBeNull()
  })
})
