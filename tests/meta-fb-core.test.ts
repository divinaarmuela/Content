import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  META_FB_DEFAULT_APP_ID, META_FB_DEFAULT_CONFIG_ID, META_FB_DEFAULT_REDIRECT_URI, PAGE_METRICS,
  appsecretProof, candidatePlan, canPublishWith, facebookRoute, fbCodeExchangeUrl, fbErrorDetail, fbErrorMessage,
  fbFailure, fbGraphUrl, fbInsightRange, fbLoginUrl, fbLongLivedUrl, fbMediaProblem, fbMultiPhotoParams, fbPublishCall,
  fbReadiness, fbRedactUrl, fbRequestFor, fbResumeDecision, fbUnpublishedPhotoParams, isGraphId, parseFbComments,
  parseFbInsights, parseFbPosts, parsePageWebhookEvents, parsePages, parseUserToken, publishedPostId,
  readFbInboxRequest, readMetaFbEnv, PAGE_WEBHOOK_FIELDS, META_FB_PERMISSIONS, parseFbConversations,
  messengerWindowOpen, fbMessageBody, readMetaFbJobState, signFbState, validateFbPublish, verifyFbState,
} from '../app/lib/meta-fb-core'
import { signState } from '../app/lib/meta-ig-core'
import { dueForDispatch, metaHold } from '../app/lib/meta-route-core'

const SECRET = 'fb-secret'

describe('env and readiness', () => {
  it('defaults to the configured app, redirect and config id; the secret is env only', () => {
    const before = { ...process.env }
    delete process.env.META_FB_APP_ID; delete process.env.META_APP_SECRET; delete process.env.META_FB_REDIRECT_URI; delete process.env.META_FB_CONFIG_ID
    const env = readMetaFbEnv()
    expect(env).toEqual({ appId: META_FB_DEFAULT_APP_ID, appSecret: null, redirectUri: META_FB_DEFAULT_REDIRECT_URI, configId: META_FB_DEFAULT_CONFIG_ID })
    expect(env.appId).toBe('2142902776443404')
    expect(env.configId).toBe('1428692675563072')
    Object.assign(process.env, before)
  })
  it('not ready without META_APP_SECRET, then without CREDENTIALS_KEY', () => {
    const env = { appId: 'a', appSecret: null, redirectUri: 'r', configId: 'c' }
    expect(fbReadiness(env, true)).toMatchObject({ ok: false, reason: expect.stringMatching(/META_APP_SECRET/) })
    expect(fbReadiness({ ...env, appSecret: 's' }, false)).toMatchObject({ ok: false, reason: expect.stringMatching(/CREDENTIALS_KEY/) })
    expect(fbReadiness({ ...env, appSecret: 's' }, true).ok).toBe(true)
  })
})

describe('the signed state', () => {
  it('round-trips, refuses tampering, expiry and an Instagram state', () => {
    const s = signFbState({ clientId: 'c1', userId: 'u1', now: 1000, nonce: 'n' }, SECRET)
    expect(verifyFbState(s, SECRET, 2000)).toMatchObject({ ok: true, payload: { clientId: 'c1', userId: 'u1' } })
    expect(verifyFbState(s, 'other', 2000)).toEqual({ ok: false, reason: 'bad_signature' })
    expect(verifyFbState(s, SECRET, 1000 + 11 * 60_000)).toEqual({ ok: false, reason: 'expired' })
    expect(verifyFbState('x', SECRET, 0)).toEqual({ ok: false, reason: 'malformed' })
    expect(verifyFbState(signState({ clientId: 'c1', userId: 'u1', now: 1000 }, SECRET), SECRET, 2000)).toEqual({ ok: false, reason: 'bad_signature' })
  })
})

describe('URLs', () => {
  it('the login dialog carries config_id and no scope', () => {
    const u = new URL(fbLoginUrl({ appId: 'A', redirectUri: 'https://x/cb', configId: 'C', state: 'S' }))
    expect(u.origin + u.pathname).toBe('https://www.facebook.com/v23.0/dialog/oauth')
    expect(Object.fromEntries(u.searchParams)).toEqual({ client_id: 'A', redirect_uri: 'https://x/cb', config_id: 'C', response_type: 'code', state: 'S' })
  })
  it('code and long-lived exchanges on graph.facebook.com v23.0', () => {
    const c = new URL(fbCodeExchangeUrl({ appId: 'A', appSecret: 'S', redirectUri: 'R', code: 'K' }))
    expect(c.pathname).toBe('/v23.0/oauth/access_token')
    expect(c.searchParams.get('code')).toBe('K')
    const l = new URL(fbLongLivedUrl({ appId: 'A', appSecret: 'S', shortToken: 'T' }))
    expect(l.searchParams.get('grant_type')).toBe('fb_exchange_token')
    expect(l.searchParams.get('fb_exchange_token')).toBe('T')
    expect(fbGraphUrl('/123/feed', { a: 1, b: undefined })).toBe('https://graph.facebook.com/v23.0/123/feed?a=1')
  })
  it('redaction removes every secret-shaped parameter', () => {
    const r = fbRedactUrl('https://graph.facebook.com/v23.0/oauth/access_token?client_secret=S&code=K&fb_exchange_token=T&access_token=X&appsecret_proof=P&ok=1')
    for (const v of ['=S', '=K', '=T', '=X', '=P']) expect(r).not.toContain(v + '&')
    expect(r).toContain('ok=1')
    expect(fbRedactUrl('not a url')).toBe('(unparseable url)')
  })
  it('appsecret_proof is HMAC-SHA256 hex', () => {
    expect(appsecretProof('tok', 'sec')).toMatch(/^[a-f0-9]{64}$/)
  })
})

describe('what Meta answers', () => {
  it('error messages never carry a token', () => {
    expect(fbErrorMessage({ error: { message: 'bad EAABwzLixnjYBO1234567890', code: 190 } })).toBe('bad [token] (code 190)')
    expect(fbErrorDetail({ error: { code: 4, is_transient: true } })).toMatchObject({ code: 4, transient: true })
  })
  it('user token and pages', () => {
    expect(parseUserToken({ access_token: 't', expires_in: 5000 })).toEqual({ ok: true, value: { accessToken: 't', expiresIn: 5000 } })
    expect(parseUserToken({ error: { message: 'no' } }).ok).toBe(false)
    const pages = parsePages({ data: [
      { id: 61596416725098, name: 'MD Media Test Page', access_token: 'pt', category: 'Brand', picture: { data: { url: 'https://p' } }, tasks: ['MANAGE', 'CREATE_CONTENT'] },
      { id: '2', name: 'no token' },
    ] })
    expect(pages).toEqual([{ id: '61596416725098', name: 'MD Media Test Page', category: 'Brand', picture: 'https://p', tasks: ['MANAGE', 'CREATE_CONTENT'], accessToken: 'pt' }])
    expect(canPublishWith(['MODERATE'])).toBe(false)
    expect(canPublishWith(['CREATE_CONTENT'])).toBe(true)
    expect(isGraphId('61596416725098_123456')).toBe(true)
    expect(isGraphId('../x')).toBe(false)
  })
})

describe('candidatePlan', () => {
  it('offers new Pages, keeps this client\'s Page, never takes another client\'s', () => {
    const existing = new Map([
      ['1', { id: '1', client_id: 'c1', active: true }],
      ['2', { id: '2', client_id: 'other', active: true }],
      ['3', { id: '3', client_id: 'other', active: false }],
    ])
    expect(candidatePlan('c1', [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }], existing)).toEqual({ offer: ['3', '4'], keep: ['1'], taken: ['2'] })
  })
})

describe('publishing', () => {
  it('builds each call', () => {
    expect(fbPublishCall('P', { kind: 'TEXT', message: 'hi' })).toEqual({ path: 'P/feed', params: { message: 'hi' } })
    expect(fbPublishCall('P', { kind: 'LINK', link: 'https://x', message: 'm' })).toEqual({ path: 'P/feed', params: { link: 'https://x', message: 'm' } })
    expect(fbPublishCall('P', { kind: 'PHOTO', url: 'u' })).toEqual({ path: 'P/photos', params: { url: 'u' } })
    expect(fbPublishCall('P', { kind: 'VIDEO', url: 'v', description: 'd' })).toEqual({ path: 'P/videos', params: { file_url: 'v', description: 'd' } })
    expect(fbUnpublishedPhotoParams('u')).toEqual({ url: 'u', published: 'false' })
    expect(fbMultiPhotoParams(['a', 'b'], 'm')).toEqual({ 'attached_media[0]': '{"media_fbid":"a"}', 'attached_media[1]': '{"media_fbid":"b"}', message: 'm' })
    expect(publishedPostId({ id: '1', post_id: 'P_1' })).toBe('P_1')
    expect(publishedPostId({ id: 'P_2' })).toBe('P_2')
    expect(publishedPostId({})).toBeNull()
  })
  it('validates', () => {
    expect(validateFbPublish({ kind: 'TEXT', message: ' ' })).toMatch(/needs/)
    expect(validateFbPublish({ kind: 'LINK', link: 'ftp://x' })).toMatch(/http/)
    expect(validateFbPublish({ kind: 'PHOTOS', urls: ['a'] })).toMatch(/2 to 10/)
    expect(validateFbPublish({ kind: 'PHOTO', url: 'u' })).toBeNull()
  })
  it('picks the request from the media; the channel caption wins', () => {
    expect(fbRequestFor({ caption: 'c', media: [] })).toMatchObject({ ok: true, req: { kind: 'TEXT', message: 'c' } })
    expect(fbRequestFor({ caption: 'c', media: [{ type: 'image', url: 'a' }], options: { caption: 'own', firstComment: ' #tag ' } }))
      .toEqual({ ok: true, req: { kind: 'PHOTO', url: 'a', message: 'own' }, firstComment: '#tag' })
    expect(fbRequestFor({ caption: 'c', media: [{ type: 'image', url: 'a' }, { type: 'image', url: 'b' }] })).toMatchObject({ ok: true, req: { kind: 'PHOTOS', urls: ['a', 'b'] } })
    expect(fbRequestFor({ caption: 'c', media: [{ type: 'video', url: 'v' }] })).toMatchObject({ ok: true, req: { kind: 'VIDEO', url: 'v', description: 'c' } })
    expect(fbRequestFor({ caption: '', media: [] }).ok).toBe(false)
    expect(fbRequestFor({ caption: 'c', media: [{ type: 'video', url: 'v' }, { type: 'image', url: 'a' }] }).ok).toBe(false)
  })
  it('media problems', () => {
    expect(fbMediaProblem([{ type: 'document' }])).toMatch(/documents/)
    expect(fbMediaProblem([{ type: 'video' }, { type: 'video' }])).toMatch(/one video/)
    expect(fbMediaProblem(Array(11).fill({ type: 'image' }))).toMatch(/10/)
    expect(fbMediaProblem([{ type: 'image' }])).toBeNull()
  })
})

describe('facebookRoute â€” Zernio unless everything holds', () => {
  const page = { id: 'P', name: 'Test', active: true }
  it('off â†’ Zernio with nothing to say', () => {
    expect(facebookRoute({ clientViaMeta: false, pages: [page], media: [] })).toEqual({ via: 'zernio', reason: null })
    expect(facebookRoute({ clientViaMeta: undefined, pages: [page], media: [] })).toEqual({ via: 'zernio', reason: null })
  })
  it('on but no picked Page, a Story/Reel, or bad media â†’ Zernio with the reason', () => {
    expect(facebookRoute({ clientViaMeta: true, pages: [{ ...page, active: false }], media: [] })).toMatchObject({ via: 'zernio', reason: expect.stringMatching(/No Facebook Page/) })
    expect(facebookRoute({ clientViaMeta: true, pages: [page], media: [{ type: 'video' }], options: { kind: 'reel' } })).toMatchObject({ via: 'zernio', reason: expect.stringMatching(/Reel/) })
    expect(facebookRoute({ clientViaMeta: true, pages: [page], media: [{ type: 'document' }] })).toMatchObject({ via: 'zernio' })
  })
  it('on, picked Page, feed post â†’ Meta', () => {
    expect(facebookRoute({ clientViaMeta: true, pages: [page], media: [{ type: 'image' }] })).toEqual({ via: 'meta', pageId: 'P', pageName: 'Test' })
  })
})

describe('never twice', () => {
  it('reads the job record and decides', () => {
    expect(readMetaFbJobState(null)).toBeNull()
    expect(readMetaFbJobState({ page_id: '' })).toBeNull()
    const s = readMetaFbJobState({ page_id: 'P' })!
    expect(fbResumeDecision(s)).toBe('send')
    expect(fbResumeDecision({ ...s, sending_at: 'x' })).toBe('unknown')
    expect(fbResumeDecision({ ...s, sending_at: 'x', post_id: 'P_1' })).toBe('done')
  })
  it('a Facebook job is held until its time like an Instagram one', () => {
    const now = Date.parse('2026-11-06T00:00:00Z')
    const later = '2026-11-07T00:00:00Z'
    expect(metaHold({ provider: 'meta_fb', scheduled_for: later }, now)).toEqual({ held: true, until: new Date(later).toISOString() })
    expect(dueForDispatch({ provider: 'meta_fb', scheduled_for: later }, now)).toBe(false)
    expect(metaHold({ provider: null, scheduled_for: later }, now)).toEqual({ held: false })
  })
  it('failures: expired token is permanent, Meta busy is retried', () => {
    expect(fbFailure({ message: 'x', detail: { code: 190, subcode: null, transient: false, userMessage: null } })).toMatchObject({ retry: false, words: expect.stringMatching(/reconnect/) })
    expect(fbFailure({ message: 'x', status: 500 }).retry).toBe(true)
    expect(fbFailure({ message: 'Could not reach Facebook (x)' }).retry).toBe(true)
    expect(fbFailure({ message: 'bad', status: 400 }).retry).toBe(false)
  })
})

describe('the inbox shapes', () => {
  it('posts', () => {
    expect(parseFbPosts({ data: [{ id: 'P_1', message: 'hi', created_time: 't', permalink_url: 'l', comments: { summary: { total_count: 3 } }, reactions: { summary: { total_count: 5 } }, shares: { count: 1 } }] }))
      .toEqual([{ id: 'P_1', message: 'hi', at: 't', permalink: 'l', picture: null, comments: 3, reactions: 5, shares: 1 }])
  })
  it('comments: newest first, replies oldest first, the Page marked as ours', () => {
    const out = parseFbComments({ data: [
      { id: '1', message: 'a', created_time: '2026-11-01', from: { id: 'u', name: 'Pat' }, can_hide: true, comments: { data: [
        { id: '1r2', message: 'later', created_time: '2026-11-03', from: { id: 'P' } },
        { id: '1r1', message: 'first', created_time: '2026-11-02', from: { id: 'P' } },
      ] } },
      { id: '2', message: 'b', created_time: '2026-11-04', is_hidden: true },
    ] }, 'P')
    expect(out.map(c => c.id)).toEqual(['2', '1'])
    expect(out[0]).toMatchObject({ hidden: true, name: null })
    expect(out[1].replies.map(r => r.id)).toEqual(['1r1', '1r2'])
    expect(out[1].replies[0].ours).toBe(true)
    expect(out[1].canHide).toBe(true)
  })
  it('insights: daily values summed, followers the latest, by-type summed; no deprecated metric asked for', () => {
    const rows = parseFbInsights({ data: [
      { name: 'page_follows', period: 'day', values: [{ value: 10 }, { value: 12 }] },
      { name: 'page_media_view', period: 'day', values: [{ value: 3 }, { value: 4 }] },
      { name: 'post_reactions_by_type_total', values: [{ value: { like: 2, love: 1 } }] },
    ] }, [...PAGE_METRICS, 'post_reactions_by_type_total'])
    expect(rows).toEqual([
      { metric: 'page_follows', label: 'Followers', value: 12 },
      { metric: 'page_media_view', label: 'Views', value: 7 },
      { metric: 'post_reactions_by_type_total', label: 'Reactions', value: 3 },
    ])
    for (const m of PAGE_METRICS) expect(m).not.toMatch(/^page_(impressions|fans|engaged_users)/)
    expect(fbInsightRange(99, 86400_000 * 100)).toMatchObject({ days: 7 })
    expect(fbInsightRange(28, 86400_000 * 100).days).toBe(28)
  })
  it('requests', () => {
    expect(readFbInboxRequest({ action: 'reply', commentId: '111_222', text: ' hi ' })).toEqual({ ok: true, value: { action: 'reply', commentId: '111_222', text: 'hi' } })
    expect(readFbInboxRequest({ action: 'reply', commentId: '111_222', text: '' }).ok).toBe(false)
    expect(readFbInboxRequest({ action: 'hide', commentId: '123' })).toEqual({ ok: true, value: { action: 'hide', commentId: '123' } })
    expect(readFbInboxRequest({ action: 'message', commentId: '123' }).ok).toBe(false)
    expect(readFbInboxRequest({ action: 'delete', commentId: 'a/b' }).ok).toBe(false)
  })
})

describe('the Page webhook', () => {
  it('keeps feed changes of object page only', () => {
    const ev = parsePageWebhookEvents({ object: 'page', entry: [{ id: '61596416725098', time: 1762400000, changes: [
      { field: 'feed', value: { item: 'comment', verb: 'add', comment_id: 'c1' } },
      { field: 'other', value: {} },
    ] }] })
    expect(ev).toHaveLength(1)
    expect(ev[0]).toMatchObject({ pageId: '61596416725098', kind: 'feed', item: 'comment', occurredAt: new Date(1762400000 * 1000).toISOString() })
    expect(ev[0].key).toMatch(/^feed_[a-f0-9]{32}$/)
    expect(parsePageWebhookEvents({ object: 'instagram', entry: [] })).toEqual([])
  })
})

describe('the portable part stays portable', () => {
  it('meta-fb-core.ts and meta-fb-client.ts import nothing of MD Media', () => {
    for (const f of ['app/lib/meta-fb-core.ts', 'app/lib/meta-fb-client.ts']) {
      const code = readFileSync(join(__dirname, '..', f), 'utf8')
      const imports = [...code.matchAll(/from\s+'([^']+)'/g)].map(m => m[1])
      expect(imports.filter(i => !i.startsWith('node:') && i !== './meta-fb-core' && i !== './meta-ig-core'), f).toEqual([])
    }
  })
})

describe('Messenger', () => {
  it('the Page subscribes to feed and messages, and pages_messaging is in the configuration', () => {
    expect([...PAGE_WEBHOOK_FIELDS]).toEqual(['feed', 'messages'])
    expect(META_FB_PERMISSIONS).toContain('pages_messaging')
  })
  it('conversations: the other participant, oldest message first, last message from them', () => {
    const [c] = parseFbConversations({ data: [{ id: 't_1', updated_time: '2026-11-06T02:00:00Z',
      participants: { data: [{ id: 'P', name: 'Page' }, { id: '999', name: 'Sam' }] },
      messages: { data: [
        { id: 'm2', created_time: '2026-11-06T02:00:00Z', from: { id: 'P' }, message: 'hello back' },
        { id: 'm1', created_time: '2026-11-06T01:00:00Z', from: { id: '999', name: 'Sam' }, message: 'hi' },
      ] } }] }, 'P')
    expect(c).toMatchObject({ personId: '999', personName: 'Sam', lastFromThemAt: '2026-11-06T01:00:00Z' })
    expect(c.messages.map(m => [m.id, m.ours])).toEqual([['m1', false], ['m2', true]])
  })
  it('the 24-hour window', () => {
    const t = Date.parse('2026-11-06T01:00:00Z')
    expect(messengerWindowOpen('2026-11-06T01:00:00Z', t + 23 * 3600_000)).toBe(true)
    expect(messengerWindowOpen('2026-11-06T01:00:00Z', t + 25 * 3600_000)).toBe(false)
    expect(messengerWindowOpen(null, t)).toBe(false)
  })
  it('a reply is RESPONSE and never tagged', () => {
    expect(fbMessageBody('999', 'hi')).toEqual({ recipient: { id: '999' }, messaging_type: 'RESPONSE', message: { text: 'hi' } })
    expect(readFbInboxRequest({ action: 'message', recipientId: '999', text: ' ok ' })).toEqual({ ok: true, value: { action: 'message', recipientId: '999', text: 'ok' } })
    expect(readFbInboxRequest({ action: 'message', recipientId: 'x', text: 'ok' }).ok).toBe(false)
    expect(readFbInboxRequest({ action: 'message', recipientId: '999', text: 'a'.repeat(2001) }).ok).toBe(false)
  })
  it('the webhook keeps messaging entries as kind messages', () => {
    const ev = parsePageWebhookEvents({ object: 'page', entry: [{ id: 'P', time: 1762400000, messaging: [
      { sender: { id: '999' }, recipient: { id: 'P' }, timestamp: 1762400000123, message: { mid: 'x', text: 'hi' } },
    ] }] })
    expect(ev).toEqual([expect.objectContaining({ kind: 'messages', item: 'message', pageId: 'P', occurredAt: new Date(1762400000123).toISOString() })])
    expect(ev[0].key).toMatch(/^messages_/)
  })
})
