import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { seedDb } from './helpers/fake-db'
import { signFbState } from '../app/lib/meta-fb-core'
import type { Row } from '@/lib/db-types'

/**
 * The Facebook Page road at its routes (6 Nov 2026) — on the in-memory RTDB, every Meta call answered by a
 * mock. Nothing reaches Facebook, nothing writes the live database, nobody is emailed.
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
vi.mock('../app/lib/mailer', () => { throw new Error('the Facebook road must not send email') })

const FB_SECRET = 'fb-app-secret'
const IG_SECRET = 'ig-app-secret'
type MetaCall = { method: string; url: URL; body: string }
let calls: MetaCall[] = []
let answer: (c: MetaCall) => unknown = () => ({})
const metaFetch = (async (input: any, init: any = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url)
  const c = { method: (init.method ?? 'GET').toUpperCase(), url, body: typeof init.body === 'string' ? init.body : '' }
  calls.push(c)
  return new Response(JSON.stringify(answer(c)), { status: 200, headers: { 'content-type': 'application/json' } })
}) as typeof fetch

let fake: ReturnType<typeof seedDb>
const original = globalThis.fetch
function setup(seed: Record<string, Row[]> = {}) {
  globalThis.fetch = metaFetch
  fake = seedDb({ clients: [{ id: 'c1', name: '100 Hundred Million Group' } as Row, { id: 'c2', name: 'ZZ TEST other' } as Row], ...seed })
}
beforeEach(() => {
  calls = []; answer = () => ({}); who = null
  vi.stubEnv('META_APP_SECRET', FB_SECRET)
  vi.stubEnv('META_IG_APP_SECRET', IG_SECRET)
  vi.stubEnv('CREDENTIALS_KEY', 'test-credentials-key')
  vi.stubEnv('META_FB_APP_ID', ''); vi.stubEnv('META_FB_REDIRECT_URI', ''); vi.stubEnv('META_FB_CONFIG_ID', '')
})
afterEach(() => { fake?.restore(); globalThis.fetch = original; vi.unstubAllEnvs() })

describe('middleware: connect/pages/inbox gated, callback public', () => {
  const src = readFileSync(join(__dirname, '..', 'middleware.ts'), 'utf8')
  const protectedBlock = src.slice(src.indexOf('createRouteMatcher(['), src.indexOf('])', src.indexOf('createRouteMatcher([')))
  const matcherBlock = src.slice(src.indexOf('matcher: ['))
  const entries = (b: string) => [...b.matchAll(/'(\/[^']+)'/g)].map(m => m[1])
  const covers = (pattern: string, path: string) => new RegExp('^' + pattern.replace(/\/:path\*$/, '(/.*)?').replace(/\(\.\*\)/g, '.*') + '$').test(path)
  it('gated routes are protected and matched', () => {
    for (const p of ['/api/meta/facebook/connect', '/api/meta/facebook/pages', '/api/meta/facebook/inbox']) {
      expect(entries(protectedBlock).some(e => covers(e, p)), p).toBe(true)
      expect(entries(matcherBlock).some(e => covers(e, p)), p).toBe(true)
    }
  })
  it('the callback is neither protected nor matched, and asks nobody who they are', () => {
    const p = '/api/meta/facebook/callback'
    expect(entries(protectedBlock).filter(e => covers(e, p))).toEqual([])
    expect(entries(matcherBlock).filter(e => covers(e, p))).toEqual([])
    const route = readFileSync(join(__dirname, '..', 'app/api/meta/facebook/callback/route.ts'), 'utf8')
    expect(route).not.toMatch(/\b(requireRole|requireSignedIn|guard|resolveTeamUser|auth)\s*\(/)
  })
})

describe('GET /api/meta/facebook/connect', () => {
  const go = (q: string) => new NextRequest(`https://app.mdmmarketing.com.au/api/meta/facebook/connect?${q}`)
  it('401 signed out, 403 below account manager, 403 for a client not theirs', async () => {
    setup()
    const { GET } = await import('../app/api/meta/facebook/connect/route')
    expect((await GET(go('clientId=c1'))).status).toBe(401)
    who = { id: 'u', role: 'editor' }
    expect((await GET(go('clientId=c1'))).status).toBe(403)
    who = { id: 'u', role: 'account_manager' }
    expect((await GET(go('clientId=c2'))).status).toBe(403)
  })
  it('503 with the reason while META_APP_SECRET is unset', async () => {
    setup(); who = { id: 'u', role: 'super_admin' }
    vi.stubEnv('META_APP_SECRET', '')
    const { GET } = await import('../app/api/meta/facebook/connect/route')
    const res = await GET(go('clientId=c1'))
    expect(res.status).toBe(503)
    expect((await res.json()).error).toMatch(/META_APP_SECRET/)
  })
  it('redirects to the Login for Business dialog with config_id and no scope', async () => {
    setup(); who = { id: 'u', role: 'account_manager' }
    const { GET } = await import('../app/api/meta/facebook/connect/route')
    const res = await GET(go('clientId=c1'))
    expect(res.status).toBe(302)
    const u = new URL(res.headers.get('location')!)
    expect(u.pathname).toBe('/v23.0/dialog/oauth')
    expect(u.searchParams.get('config_id')).toBe('1428692675563072')
    expect(u.searchParams.get('client_id')).toBe('2142902776443404')
    expect(u.searchParams.get('redirect_uri')).toBe('https://app.mdmmarketing.com.au/api/meta/facebook/callback')
    expect(u.searchParams.has('scope')).toBe(false)
  })
})

describe('GET /api/meta/facebook/callback', () => {
  const cb = (q: string) => new NextRequest(`https://app.mdmmarketing.com.au/api/meta/facebook/callback?${q}`)
  const pagesAnswer = (c: MetaCall) => {
    if (c.url.pathname.endsWith('/oauth/access_token')) return { access_token: c.url.searchParams.get('grant_type') ? 'LONG-USER' : 'SHORT-USER', expires_in: 5000 }
    if (c.url.pathname.endsWith('/me/accounts')) return { data: [
      { id: '61596416725098', name: 'MD Media Test Page', access_token: 'PAGE-TOKEN-1', category: 'Brand', tasks: ['MANAGE'] },
      { id: '2222', name: 'Another Page', access_token: 'PAGE-TOKEN-2', tasks: ['MANAGE'] },
    ] }
    if (c.url.pathname.endsWith('/subscribed_apps')) return { success: true }
    return {}
  }

  it('refuses a bad state', async () => {
    setup()
    const { GET } = await import('../app/api/meta/facebook/callback/route')
    expect((await GET(cb('state=nope&code=x'))).status).toBe(400)
  })

  it('stores every Page as a candidate (tokens encrypted), sends the person to pick, and never puts a token in the URL', async () => {
    setup(); answer = pagesAnswer
    const { GET } = await import('../app/api/meta/facebook/callback/route')
    const state = signFbState({ clientId: 'c1', userId: 'u1', now: Date.now() }, FB_SECRET)
    const res = await GET(cb(`state=${encodeURIComponent(state)}&code=CODE`))
    expect(res.status).toBe(302)
    const loc = res.headers.get('location')!
    expect(loc).toContain('/dashboard/clients/c1/social')
    expect(new URL(loc).searchParams.get('meta_fb')).toBe('pick')
    expect(loc).not.toMatch(/TOKEN|USER/)
    const rows = fake.rows('meta_fb_pages') as any[]
    expect(rows.map(r => r.id).sort()).toEqual(['2222', '61596416725098'])
    expect(rows.every(r => r.active === false && r.client_id === 'c1')).toBe(true)
    for (const r of rows) expect(JSON.stringify(r)).not.toMatch(/PAGE-TOKEN/)
    // every call carried appsecret_proof
    expect(calls.filter(c => c.url.searchParams.has('access_token')).every(c => c.url.searchParams.has('appsecret_proof'))).toBe(true)
  })

  it('a super admin picks the Page: the other candidate goes, the Page is subscribed to feed + messages', async () => {
    setup(); answer = pagesAnswer
    const { GET } = await import('../app/api/meta/facebook/callback/route')
    await GET(cb(`state=${encodeURIComponent(signFbState({ clientId: 'c1', userId: 'u1', now: Date.now() }, FB_SECRET))}&code=CODE`))
    const route = await import('../app/api/meta/facebook/pages/route')
    const post = (body: unknown) => route.POST(new NextRequest('https://x/api/meta/facebook/pages', { method: 'POST', body: JSON.stringify(body) }))
    who = { id: 'u', role: 'account_manager' }
    expect((await post({ clientId: 'c1', action: 'pick', pageId: '61596416725098' })).status).toBe(403)
    who = { id: 'u', role: 'super_admin' }
    expect((await post({ clientId: 'c1', action: 'pick', pageId: '61596416725098' })).status).toBe(200)
    const rows = fake.rows('meta_fb_pages') as any[]
    expect(rows.map(r => [r.id, r.active])).toEqual([['61596416725098', true]])
    const sub = calls.find(c => c.url.pathname.endsWith('/61596416725098/subscribed_apps'))!
    expect(new URLSearchParams(sub.body).get('subscribed_fields')).toBe('feed,messages')

    // the GET never returns a token
    const got = await route.GET(new NextRequest('https://x/api/meta/facebook/pages?clientId=c1'))
    expect(JSON.stringify(await got.json())).not.toMatch(/access_token_encrypted|PAGE-TOKEN/)
  })

  it('the switch cannot go on without a picked Page', async () => {
    setup(); who = { id: 'u', role: 'super_admin' }
    const route = await import('../app/api/meta/facebook/pages/route')
    const res = await route.PATCH(new NextRequest('https://x', { method: 'PATCH', body: JSON.stringify({ clientId: 'c1', viaMeta: true }) }))
    expect(res.status).toBe(409)
  })
})

describe('publishJobToFacebook — never twice', () => {
  const page = async () => {
    const { encryptSecret } = await import('../app/lib/secret-box')
    return { id: '61596416725098', client_id: 'c1', active: true, access_token_encrypted: encryptSecret('PT') } as unknown as Row
  }
  const job = (meta_fb: unknown) => ({ id: 'j1', caption: 'Hello', media: [{ type: 'image' as const, url: 'https://cdn/x.jpg' }], targets: [{ platform: 'facebook', accountId: 'a' }] as never, meta_fb })

  it('posts a photo once and records the post id', async () => {
    setup({ meta_fb_pages: [await page()], publish_jobs: [{ id: 'j1' } as Row] })
    answer = c => c.url.pathname.endsWith('/photos') ? { id: '1', post_id: '61596416725098_9' } : c.url.pathname.endsWith('_9') ? { permalink_url: 'https://fb/p' } : {}
    const { publishJobToFacebook } = await import('../app/lib/meta-fb-publish')
    const out = await publishJobToFacebook(job({ page_id: '61596416725098' }))
    expect(out).toMatchObject({ kind: 'published', postId: '61596416725098_9', permalink: 'https://fb/p' })
    expect(calls.filter(c => c.method === 'POST')).toHaveLength(1)
    expect((fake.rows('publish_jobs')[0] as any).meta_fb).toMatchObject({ post_id: '61596416725098_9' })
  })
  it('a try cut off mid-call (sending_at, no post id) is not sent again', async () => {
    setup({ meta_fb_pages: [await page()] })
    const { publishJobToFacebook } = await import('../app/lib/meta-fb-publish')
    const out = await publishJobToFacebook(job({ page_id: '61596416725098', sending_at: '2026-11-06T00:00:00Z' }))
    expect(out.kind).toBe('permanent')
    expect(calls).toEqual([])
  })
})

describe('POST /api/meta/webhook — Page deliveries', () => {
  const sign = (raw: string, s: string) => 'sha256=' + createHmac('sha256', s).update(raw).digest('hex')
  const hook = (raw: string, sig: string) => new NextRequest('https://app.mdmmarketing.com.au/api/meta/webhook', { method: 'POST', headers: { 'x-hub-signature-256': sig }, body: raw })
  const body = JSON.stringify({ object: 'page', entry: [{ id: '61596416725098', time: 1762400000,
    changes: [{ field: 'feed', value: { item: 'comment', verb: 'add', comment_id: 'c_1' } }],
    messaging: [{ sender: { id: '999' }, recipient: { id: '61596416725098' }, timestamp: 1762400000123, message: { mid: 'm', text: 'hi' } }] }] })

  it('stores feed + messages signed with META_APP_SECRET, once, and calls nobody', async () => {
    setup({ meta_fb_pages: [{ id: '61596416725098', client_id: 'c1', active: true } as Row] })
    const { POST } = await import('../app/api/meta/webhook/route')
    const res = await POST(hook(body, sign(body, FB_SECRET)))
    expect(await res.json()).toEqual({ ok: true, stored: 2 })
    expect(await (await POST(hook(body, sign(body, FB_SECRET)))).json()).toEqual({ ok: true, duplicate: true })
    const ev = fake.rows('meta_fb_events') as any[]
    expect(ev.map(e => e.kind).sort()).toEqual(['feed', 'messages'])
    expect(ev.every(e => e.client_id === 'c1')).toBe(true)
    expect(calls).toEqual([])
  })
  it('a Page body signed with the Instagram secret is refused', async () => {
    setup()
    const { POST } = await import('../app/api/meta/webhook/route')
    expect((await POST(hook(body, sign(body, IG_SECRET)))).status).toBe(401)
    expect(fake.rows('meta_fb_events')).toEqual([])
  })
  it('an Instagram body signed with the Facebook secret is refused', async () => {
    setup()
    const ig = JSON.stringify({ object: 'instagram', entry: [] })
    const { POST } = await import('../app/api/meta/webhook/route')
    expect((await POST(hook(ig, sign(ig, FB_SECRET)))).status).toBe(401)
    expect((await POST(hook(ig, sign(ig, IG_SECRET)))).status).toBe(200)
  })
})
