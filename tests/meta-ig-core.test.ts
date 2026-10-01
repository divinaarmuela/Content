import { describe, expect, it } from 'vitest'
import { createHmac } from 'node:crypto'
import {
  META_IG_SCOPES, authorizeUrl, carouselItemParams, carouselParentParams, codeExchangeBody, containerParams,
  containerState, deliveryIdOf, graphErrorMessage, handshakeChallenge, longLivedTokenUrl, messageBody,
  parseLongToken, parseMe, parseShortToken, parseWebhookEvents, publishingRoom, redactUrl, refreshTokenUrl,
  selectForRefresh, signState, validatePublish, verifyState, verifyWebhookSignature, DAY_MS,
} from '../app/lib/meta-ig-core'

/* ── the agency's own Instagram Login: the pure half (1 Oct 2026) ── */

const SECRET = 'ig-app-secret'
const NOW = Date.parse('2026-10-01T02:00:00Z')

describe('the signed state', () => {
  it('round-trips the client and the person', () => {
    const s = signState({ clientId: 'c1', userId: 'u1', now: NOW }, SECRET)
    const r = verifyState(s, SECRET, NOW + 1000)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.payload).toMatchObject({ clientId: 'c1', userId: 'u1', exp: NOW + 10 * 60 * 1000 })
  })

  it('expires after ten minutes', () => {
    const s = signState({ clientId: 'c1', userId: 'u1', now: NOW }, SECRET)
    expect(verifyState(s, SECRET, NOW + 10 * 60 * 1000)).toEqual({ ok: false, reason: 'expired' })
  })

  it('refuses a tampered payload, a wrong secret and junk', () => {
    const s = signState({ clientId: 'c1', userId: 'u1', now: NOW }, SECRET)
    const [, sig] = s.split('.')
    const forged = Buffer.from(JSON.stringify({ clientId: 'c2', userId: 'u1', exp: NOW + 600000, n: 'x' })).toString('base64url')
    expect(verifyState(`${forged}.${sig}`, SECRET, NOW)).toEqual({ ok: false, reason: 'bad_signature' })
    expect(verifyState(s, 'another-secret', NOW)).toEqual({ ok: false, reason: 'bad_signature' })
    expect(verifyState(s.slice(0, -2), SECRET, NOW).ok).toBe(false)
    expect(verifyState('nonsense', SECRET, NOW)).toEqual({ ok: false, reason: 'malformed' })
    expect(verifyState(null, SECRET, NOW)).toEqual({ ok: false, reason: 'malformed' })
  })

  it('two connects in the same millisecond differ', () => {
    expect(signState({ clientId: 'c', userId: 'u', now: NOW }, SECRET))
      .not.toBe(signState({ clientId: 'c', userId: 'u', now: NOW }, SECRET))
  })
})

describe('the URLs', () => {
  it('authorize carries the app, the redirect, code, every scope and the state', () => {
    const u = new URL(authorizeUrl({ appId: '843035665085991', redirectUri: 'https://app.example/cb', state: 'st' }))
    expect(u.origin + u.pathname).toBe('https://www.instagram.com/oauth/authorize')
    expect(u.searchParams.get('client_id')).toBe('843035665085991')
    expect(u.searchParams.get('redirect_uri')).toBe('https://app.example/cb')
    expect(u.searchParams.get('response_type')).toBe('code')
    expect(u.searchParams.get('scope')!.split(',')).toEqual([...META_IG_SCOPES])
    expect(u.searchParams.get('state')).toBe('st')
  })

  it('the code exchange strips Instagram\'s trailing #_', () => {
    const b = codeExchangeBody({ appId: 'a', appSecret: 's', redirectUri: 'r', code: 'abc#_' })
    expect(b.get('code')).toBe('abc')
    expect(b.get('grant_type')).toBe('authorization_code')
  })

  it('long-lived and refresh grants', () => {
    expect(new URL(longLivedTokenUrl({ appSecret: 's', shortToken: 't' })).searchParams.get('grant_type')).toBe('ig_exchange_token')
    const r = new URL(refreshTokenUrl('t'))
    expect(r.pathname).toBe('/refresh_access_token')
    expect(r.searchParams.get('grant_type')).toBe('ig_refresh_token')
  })

  it('redacts tokens out of a URL', () => {
    const red = redactUrl('https://graph.instagram.com/me?access_token=SECRET&fields=x&client_secret=S2')
    expect(red).not.toContain('SECRET')
    expect(red).not.toContain('S2')
  })
})

describe('parsing what Meta answers', () => {
  it('both code-exchange shapes', () => {
    expect(parseShortToken({ data: [{ access_token: 'T', user_id: 17, permissions: 'a,b' }] }))
      .toEqual({ ok: true, value: { accessToken: 'T', userId: '17', permissions: ['a', 'b'] } })
    expect(parseShortToken({ access_token: 'T', user_id: '17', permissions: ['a'] }))
      .toEqual({ ok: true, value: { accessToken: 'T', userId: '17', permissions: ['a'] } })
    expect(parseShortToken({ error_type: 'OAuthException', code: 400, error_message: 'bad code' }))
      .toEqual({ ok: false, error: 'bad code' })
  })

  it('long-lived token and /me', () => {
    expect(parseLongToken({ access_token: 'L', expires_in: 5183944 })).toEqual({ ok: true, value: { accessToken: 'L', expiresIn: 5183944 } })
    expect(parseMe({ id: 'app-scoped', user_id: '1789', username: 'mdm', account_type: 'BUSINESS' }))
      .toEqual({ ok: true, value: { userId: '1789', username: 'mdm', accountType: 'BUSINESS' } })
    expect(parseMe({ error: { message: 'Invalid OAuth access token', code: 190 } }))
      .toEqual({ ok: false, error: 'Invalid OAuth access token (code 190)' })
  })

  it('graph errors never echo anything but the message', () => {
    expect(graphErrorMessage({ error: { message: 'm', code: 4, error_subcode: 2207042 } })).toBe('m (code 4/2207042)')
    expect(graphErrorMessage(null, 502)).toBe('HTTP 502')
  })
})

describe('which tokens the daily job refreshes', () => {
  const row = (id: string, o: Partial<{ status: string; token_expires_at: string | null; connected_at: string; refreshed_at: string | null }>) => ({
    id, status: 'active', token_expires_at: null, connected_at: new Date(NOW - 30 * DAY_MS).toISOString(), refreshed_at: null, ...o,
  })
  const at = (days: number) => new Date(NOW + days * DAY_MS).toISOString()

  it('inside 15 days and older than a day: refresh', () => {
    const { refresh, expire } = selectForRefresh([row('a', { token_expires_at: at(10) })], NOW)
    expect(refresh.map(r => r.id)).toEqual(['a'])
    expect(expire).toEqual([])
  })

  it('far from expiry: left alone', () => {
    expect(selectForRefresh([row('a', { token_expires_at: at(40) })], NOW).refresh).toEqual([])
  })

  it('refreshed under 24 hours ago: left alone, even near expiry', () => {
    const r = row('a', { token_expires_at: at(5), refreshed_at: new Date(NOW - 2 * 60 * 60 * 1000).toISOString() })
    expect(selectForRefresh([r], NOW).refresh).toEqual([])
  })

  it('already past expiry: marked expired, not refreshed', () => {
    const { refresh, expire } = selectForRefresh([row('a', { token_expires_at: at(-1) })], NOW)
    expect(refresh).toEqual([])
    expect(expire.map(r => r.id)).toEqual(['a'])
  })

  it('not active: ignored; no known expiry: refreshed to learn it', () => {
    const { refresh, expire } = selectForRefresh([row('x', { status: 'expired', token_expires_at: at(1) }), row('n', {})], NOW)
    expect(refresh.map(r => r.id)).toEqual(['n'])
    expect(expire).toEqual([])
  })
})

describe('webhooks', () => {
  it('the handshake echoes the challenge only for subscribe + the right token', () => {
    const p = (o: Record<string, string>) => new URLSearchParams(o)
    expect(handshakeChallenge(p({ 'hub.mode': 'subscribe', 'hub.verify_token': 'vt', 'hub.challenge': '42' }), 'vt')).toBe('42')
    expect(handshakeChallenge(p({ 'hub.mode': 'subscribe', 'hub.verify_token': 'no', 'hub.challenge': '42' }), 'vt')).toBeNull()
    expect(handshakeChallenge(p({ 'hub.mode': 'unsubscribe', 'hub.verify_token': 'vt', 'hub.challenge': '42' }), 'vt')).toBeNull()
    expect(handshakeChallenge(p({ 'hub.mode': 'subscribe', 'hub.challenge': '42' }), 'vt')).toBeNull()
  })

  it('the signature is HMAC-SHA256 of the raw body', () => {
    const raw = '{"object":"instagram","entry":[]}'
    const good = 'sha256=' + createHmac('sha256', SECRET).update(raw).digest('hex')
    expect(verifyWebhookSignature(raw, good, SECRET)).toBe(true)
    expect(verifyWebhookSignature(raw + ' ', good, SECRET)).toBe(false)
    expect(verifyWebhookSignature(raw, good, 'other')).toBe(false)
    expect(verifyWebhookSignature(raw, 'sha1=abc', SECRET)).toBe(false)
    expect(verifyWebhookSignature(raw, null, SECRET)).toBe(false)
  })

  it('keeps comments, mentions and messages; drops the rest', () => {
    const body = {
      object: 'instagram',
      entry: [{
        id: '1789', time: 1759280000,
        changes: [
          { field: 'comments', value: { id: 'c1', text: 'hi', from: { id: 'p', username: 'pat' }, media: { id: 'm1' } } },
          { field: 'mentions', value: { media_id: 'm2', comment_id: 'c2' } },
          { field: 'story_insights', value: { media_id: 's1', reach: 4 } },
        ],
        messaging: [{ sender: { id: 'p' }, recipient: { id: '1789' }, timestamp: 1759280000123, message: { mid: 'mid1', text: 'yo' } }],
      }],
    }
    const evs = parseWebhookEvents(body)
    expect(evs.map(e => e.kind)).toEqual(['comments', 'mentions', 'messages'])
    expect(evs.every(e => e.igUserId === '1789')).toBe(true)
    expect(evs[0].occurredAt).toBe(new Date(1759280000 * 1000).toISOString())
    expect(evs[2].occurredAt).toBe(new Date(1759280000123).toISOString())
    // the same event parsed again has the same key
    expect(parseWebhookEvents(body)[0].key).toBe(evs[0].key)
    expect(parseWebhookEvents({ object: 'page', entry: [] })).toEqual([])
  })

  it('a delivery id is stable per body', () => {
    expect(deliveryIdOf('a')).toBe(deliveryIdOf('a'))
    expect(deliveryIdOf('a')).not.toBe(deliveryIdOf('b'))
  })
})

describe('publishing params', () => {
  it('image, reel, story and carousel', () => {
    expect(containerParams({ kind: 'IMAGE', imageUrl: 'https://x/i.jpg', caption: 'c' })).toEqual({ image_url: 'https://x/i.jpg', caption: 'c' })
    expect(containerParams({ kind: 'REELS', videoUrl: 'https://x/v.mp4' })).toEqual({ media_type: 'REELS', video_url: 'https://x/v.mp4' })
    expect(containerParams({ kind: 'STORIES', media: { type: 'video', url: 'u' } })).toEqual({ media_type: 'STORIES', video_url: 'u' })
    expect(containerParams({ kind: 'STORIES', media: { type: 'image', url: 'u' } })).toEqual({ media_type: 'STORIES', image_url: 'u' })
    expect(carouselItemParams({ type: 'image', url: 'u' })).toEqual({ image_url: 'u', is_carousel_item: 'true' })
    expect(carouselParentParams(['1', '2'], 'c')).toEqual({ media_type: 'CAROUSEL', children: '1,2', caption: 'c' })
  })

  it('limits and quota', () => {
    expect(validatePublish({ kind: 'CAROUSEL', items: [{ type: 'image', url: 'u' }] })).toMatch(/2 to 10/)
    expect(validatePublish({ kind: 'IMAGE', imageUrl: 'u', caption: 'x'.repeat(2201) })).toMatch(/2,200/)
    expect(publishingRoom({ data: [{ quota_usage: 3, config: { quota_total: 100 } }] })).toEqual({ used: 3, total: 100 })
    expect(publishingRoom({})).toBeNull()
    expect(containerState('FINISHED')).toBe('ready')
    expect(containerState('ERROR')).toBe('failed')
    expect(containerState('IN_PROGRESS')).toBe('waiting')
  })

  it('a private reply addresses the comment; HUMAN_AGENT only when asked', () => {
    expect(messageBody({ commentId: 'c1' }, 'hi')).toEqual({ recipient: { comment_id: 'c1' }, message: { text: 'hi' } })
    expect(messageBody({ userId: 'p' }, 'hi')).toEqual({ recipient: { id: 'p' }, message: { text: 'hi' } })
    expect(messageBody({ userId: 'p' }, 'hi', { humanAgent: true })).toMatchObject({ messaging_type: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' })
  })
})
