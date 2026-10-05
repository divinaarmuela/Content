import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'
import {
  ACCOUNT_METRICS, insightRange, parseComments, parseConversations, parseInsights, parsePosts, readInboxRequest, replyWindowOpen,
} from '../app/lib/meta-ig-inbox-core'

/**
 * COMMENTS, MESSAGES AND INSIGHTS THROUGH OUR OWN META APP (5 Oct 2026, the
 * owner: "one big submission", "make sure we get all their features"). The
 * pure half, then the route against the real lib/db on the in-memory RTDB
 * with every Instagram call answered by a mock. Nothing here reaches Instagram.
 */

/* ── the pure half ───────────────────────────────────────────────────── */

describe('what Instagram answers, read', () => {
  it('posts: a video draws its still, never the video file', () => {
    const posts = parsePosts({ data: [
      { id: 'm1', caption: 'Hello', media_type: 'IMAGE', media_url: 'https://x/i.jpg', timestamp: '2026-10-01T00:00:00+0000', comments_count: 2, like_count: 5 },
      { id: 'm2', media_type: 'VIDEO', media_product_type: 'REELS', media_url: 'https://x/v.mp4', thumbnail_url: 'https://x/t.jpg' },
      { id: 'm3', media_type: 'VIDEO', media_url: 'https://x/v.mp4' },
    ] })
    expect(posts[0]).toMatchObject({ id: 'm1', picture: 'https://x/i.jpg', comments: 2, likes: 5 })
    expect(posts[1]).toMatchObject({ kind: 'REELS', picture: 'https://x/t.jpg', caption: null })
    expect(posts[2].picture).toBeNull()
  })

  it('comments: newest first, replies oldest first, the account\'s own marked', () => {
    const out = parseComments({ data: [
      { id: 'c1', text: 'price?', username: 'pat', timestamp: '2026-10-01T01:00:00+0000', replies: { data: [
        { id: 'r2', text: 'thanks', username: 'pat', timestamp: '2026-10-01T03:00:00+0000' },
        { id: 'r1', text: 'DM sent', from: { id: '1789', username: 'biz' }, timestamp: '2026-10-01T02:00:00+0000' },
      ] } },
      { id: 'c2', text: 'spam', username: 'bot', timestamp: '2026-10-02T01:00:00+0000', hidden: true },
    ] }, { userId: '1789', username: 'biz' })
    expect(out.map(c => c.id)).toEqual(['c2', 'c1'])
    expect(out[0].hidden).toBe(true)
    expect(out[1].replies.map(r => [r.id, r.ours])).toEqual([['r1', true], ['r2', false]])
  })

  it('a reply Instagram lists twice is drawn once, under its parent, with its author (seen live on 100M, 5 Oct 2026)', () => {
    const out = parseComments({ data: [
      { id: 'r1', text: 'Just sent it to your DMs.', username: 'biz', timestamp: '2026-10-01T02:00:00+0000' },
      { id: 'c1', text: 'LINK', username: 'pat', timestamp: '2026-10-01T01:00:00+0000', replies: { data: [
        { id: 'r1', text: 'Just sent it to your DMs.', timestamp: '2026-10-01T02:00:00+0000' },
      ] } },
    ] }, { userId: '1789', username: 'biz' })
    expect(out.map(c => c.id)).toEqual(['c1'])
    expect(out[0].replies).toMatchObject([{ id: 'r1', username: 'biz', ours: true }])
  })

  it('conversations: the other person, the thread oldest first, and the 24 hours', () => {
    const [c] = parseConversations({ data: [{ id: 'conv1', updated_time: '2026-10-05T00:00:00+0000', messages: { data: [
      { id: 'x2', created_time: '2026-10-05T00:00:00+0000', from: { id: '1789', username: 'biz' }, to: { data: [{ id: 'p1', username: 'pat' }] }, message: 'hi back' },
      { id: 'x1', created_time: '2026-10-04T23:00:00+0000', from: { id: 'p1', username: 'pat' }, to: { data: [{ id: '1789' }] }, message: 'hello' },
    ] } }] }, '1789')
    expect(c).toMatchObject({ personId: 'p1', personName: 'pat', lastFromThemAt: '2026-10-04T23:00:00+0000' })
    expect(c.messages.map(m => [m.id, m.ours])).toEqual([['x1', false], ['x2', true]])
    const at = Date.parse('2026-10-04T23:00:00+0000')
    expect(replyWindowOpen(c.lastFromThemAt, at + 23 * 3600e3)).toBe(true)
    expect(replyWindowOpen(c.lastFromThemAt, at + 25 * 3600e3)).toBe(false)
    expect(replyWindowOpen(null, at)).toBe(false)
  })

  it('a conversation only we wrote in still knows who it is with', () => {
    const [c] = parseConversations({ data: [{ id: 'conv2', messages: { data: [
      { id: 'x1', created_time: '2026-10-05T00:00:00+0000', from: { id: '1789' }, to: { data: [{ id: 'p9', username: 'sam' }] }, message: 'hello' },
    ] } }] }, '1789')
    expect(c).toMatchObject({ personId: 'p9', personName: 'sam', lastFromThemAt: null })
  })

  it('insights: total_value and a time series both read; the order is ours; impressions is never asked for', () => {
    const rows = parseInsights({ data: [
      { name: 'views', total_value: { value: 40 } },
      { name: 'reach', values: [{ value: 3 }, { value: 4 }] },
      { name: 'unknown_metric', total_value: { value: 1 } },
    ] }, ACCOUNT_METRICS)
    expect(rows).toEqual([{ metric: 'reach', label: 'Accounts reached', value: 7 }, { metric: 'views', label: 'Views', value: 40 }])
    expect(ACCOUNT_METRICS).not.toContain('impressions')
    const r = insightRange(28, 1_760_000_000_000)
    expect(r.until - r.since).toBe(28 * 86400)
    const odd = insightRange(365, 1_760_000_000_000)
    expect(odd.until - odd.since).toBe(7 * 86400)
  })
})

describe('what a person may ask for', () => {
  it('a reply and a message need words; hide, unhide and delete need only the comment', () => {
    expect(readInboxRequest({ action: 'reply', commentId: '179', text: ' Thanks! ' })).toEqual({ ok: true, value: { action: 'reply', commentId: '179', text: 'Thanks!' } })
    expect(readInboxRequest({ action: 'reply', commentId: '179', text: '  ' })).toMatchObject({ ok: false })
    expect(readInboxRequest({ action: 'hide', commentId: '179' })).toEqual({ ok: true, value: { action: 'hide', commentId: '179' } })
    expect(readInboxRequest({ action: 'delete' })).toMatchObject({ ok: false })
    expect(readInboxRequest({ action: 'message', recipientId: 'p1', text: 'x'.repeat(1001) })).toMatchObject({ ok: false })
    expect(readInboxRequest({ action: 'message', recipientId: 'p1', text: 'hi' })).toMatchObject({ ok: true })
    expect(readInboxRequest({ action: 'publish', commentId: '1' })).toEqual({ ok: false, error: 'Unknown action' })
  })
  it('an id that could walk the Graph path is refused', () => {
    expect(readInboxRequest({ action: 'hide', commentId: '179/../me' })).toMatchObject({ ok: false })
    expect(readInboxRequest({ action: 'hide', commentId: '179?fields=x' })).toMatchObject({ ok: false })
  })
})

/* ── the route ───────────────────────────────────────────────────────── */

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
vi.mock('../app/lib/mailer', () => { throw new Error('the Instagram inbox must not send email') })

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
async function setup(extra: Record<string, Row[]> = {}) {
  vi.stubEnv('META_IG_APP_SECRET', 'ig-app-secret')
  vi.stubEnv('CREDENTIALS_KEY', 'test-credentials-key')
  const { encryptSecret } = await import('../app/lib/secret-box')
  globalThis.fetch = metaFetch
  fake = seedDb({
    clients: [{ id: 'c1', name: '100M' } as Row, { id: 'c2', name: 'Other' } as Row],
    team_user_clients: [{ id: 'l1', team_user_id: 'tu-am', client_id: 'c1' } as Row],
    meta_ig_accounts: [{ id: '1789', client_id: 'c1', username: 'biz', status: 'active', access_token_encrypted: encryptSecret('tok-1789') } as Row],
    ...extra,
  })
}
beforeEach(() => { metaCalls = []; answer = () => ({}); who = null })
afterEach(() => { fake?.restore(); globalThis.fetch = original; vi.unstubAllEnvs() })

const BASE = 'https://app.mdmmarketing.com.au/api/meta/instagram/inbox'
const get = async (qs: string) => (await import('../app/api/meta/instagram/inbox/route')).GET(new NextRequest(`${BASE}?${qs}`))
const post = async (body: unknown) => (await import('../app/api/meta/instagram/inbox/route')).POST(new NextRequest(BASE, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}))

describe('/api/meta/instagram/inbox — who', () => {
  it('an account manager on the client reads it; one who is not on it, an editor and a stranger are refused, and Instagram is never called', async () => {
    await setup()
    who = { id: 'tu-am', role: 'account_manager' }
    expect((await get('clientId=c1&view=posts')).status).toBe(200)
    metaCalls = []
    expect((await get('clientId=c2&view=posts')).status).toBe(403)
    expect((await post({ clientId: 'c2', action: 'hide', commentId: '1' })).status).toBe(403)
    who = { id: 'tu-ed', role: 'editor' }
    expect((await get('clientId=c1&view=posts')).status).toBe(403)
    who = null
    expect((await post({ clientId: 'c1', action: 'hide', commentId: '1' })).status).toBe(401)
    expect(metaCalls).toEqual([])
  })

  it('a client with no direct connection, or an expired one, is told so and Instagram is not called', async () => {
    await setup({ meta_ig_accounts: [{ id: '55', client_id: 'c2', status: 'expired', access_token_encrypted: 'x' } as Row] })
    who = { id: 'boss', role: 'super_admin' }
    const none = await get('clientId=c1&view=messages')
    expect(none.status).toBe(409)
    const expired = await get('clientId=c2&view=messages')
    expect(expired.status).toBe(409)
    expect((await expired.json()).error).toContain('expired')
    expect(metaCalls).toEqual([])
  })
})

describe('/api/meta/instagram/inbox — the calls, each with the client\'s own token', () => {
  beforeEach(async () => { await setup(); who = { id: 'tu-am', role: 'account_manager' } })
  const last = () => metaCalls[metaCalls.length - 1]

  it('posts, comments (with the post\'s numbers), messages and insights are read from graph.instagram.com', async () => {
    answer = c => c.url.pathname.endsWith('/1789/media') ? { data: [{ id: 'm1', media_type: 'IMAGE', media_url: 'https://x/i.jpg', comments_count: 1 }] } : { data: [] }
    const posts = await (await get('clientId=c1&view=posts')).json()
    expect(posts.posts[0]).toMatchObject({ id: 'm1', comments: 1 })
    expect(last().url.host).toBe('graph.instagram.com')
    expect(last().url.searchParams.get('access_token')).toBe('tok-1789')

    metaCalls = []
    await get('clientId=c1&view=comments&mediaId=m1')
    expect(metaCalls.map(c => c.url.pathname).sort()).toEqual(['/v23.0/m1/comments', '/v23.0/m1/insights'])

    metaCalls = []
    await get('clientId=c1&view=messages')
    expect(last().url.pathname).toBe('/v23.0/me/conversations')
    expect(last().url.searchParams.get('platform')).toBe('instagram')

    metaCalls = []
    const ins = await (await get('clientId=c1&view=insights&days=28')).json()
    const call = metaCalls.find(c => c.url.pathname === '/v23.0/1789/insights')!
    expect(call.url.searchParams.get('metric_type')).toBe('total_value')
    expect(call.url.searchParams.get('metric')).not.toContain('impressions')
    expect(ins.days).toBe(28)
  })

  it('reply, hide, unhide, delete, a private reply and a message each make exactly one call', async () => {
    answer = () => ({ id: 'new1', success: true, message_id: 'mid1' })
    expect((await post({ clientId: 'c1', action: 'reply', commentId: '179', text: 'Thanks!' })).status).toBe(200)
    expect([last().method, last().url.pathname, last().body]).toEqual(['POST', '/v23.0/179/replies', 'message=Thanks%21'])

    await post({ clientId: 'c1', action: 'hide', commentId: '179' })
    expect([last().method, last().url.pathname, last().body]).toEqual(['POST', '/v23.0/179', 'hide=true'])
    await post({ clientId: 'c1', action: 'unhide', commentId: '179' })
    expect(last().body).toBe('hide=false')

    await post({ clientId: 'c1', action: 'delete', commentId: '179' })
    expect([last().method, last().url.pathname]).toEqual(['DELETE', '/v23.0/179'])

    await post({ clientId: 'c1', action: 'private_reply', commentId: '179', text: 'Sent you the price' })
    expect(JSON.parse(last().body)).toEqual({ recipient: { comment_id: '179' }, message: { text: 'Sent you the price' } })

    await post({ clientId: 'c1', action: 'message', recipientId: 'p1', text: 'Hello' })
    // inside Instagram's 24 hours only: the HUMAN_AGENT tag is never sent from here
    expect(JSON.parse(last().body)).toEqual({ recipient: { id: 'p1' }, message: { text: 'Hello' } })
    expect(metaCalls).toHaveLength(6)
  })

  it('Instagram\'s refusal comes back in its own words as a 502, and a bad request never reaches Instagram', async () => {
    answer = () => ({ __status: 400, error: { message: 'This message is sent outside of allowed window.', code: 10, error_subcode: 2534022 } })
    const res = await post({ clientId: 'c1', action: 'message', recipientId: 'p1', text: 'Hello' })
    expect(res.status).toBe(502)
    expect((await res.json()).error).toContain('outside of allowed window')
    metaCalls = []
    expect((await post({ clientId: 'c1', action: 'reply', commentId: '179', text: '' })).status).toBe(400)
    expect((await get('clientId=c1&view=comments&mediaId=a/b')).status).toBe(400)
    expect((await get('clientId=c1&view=everything')).status).toBe(400)
    expect(metaCalls).toEqual([])
  })
})

describe('nothing answers on its own', () => {
  it('no job and no webhook imports the inbox: only a person\'s press reaches it', () => {
    expect(readFileSync('app/inngest/functions.ts', 'utf8')).not.toContain('meta-ig-inbox')
    expect(readFileSync('app/api/meta/webhook/route.ts', 'utf8')).not.toContain('meta-ig-inbox')
  })
  it('the route is behind the sign-in, and the screen asks before a delete', () => {
    const mw = readFileSync('middleware.ts', 'utf8')
    expect(mw).toContain("'/api/meta/instagram/inbox(.*)'")
    expect(mw).toContain("    '/api/meta/instagram/inbox',")
    const ui = readFileSync('app/dashboard/clients/MetaInstagramInbox.tsx', 'utf8')
    expect(ui).toContain('Delete this comment from Instagram? It cannot be brought back.')
    expect(ui).not.toContain('confirm(')
  })
})
