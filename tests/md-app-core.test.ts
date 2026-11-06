import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MD_APP_DEFAULT_APP_ID, MD_APP_DEFAULT_CONFIG_ID, MD_APP_DEFAULT_REDIRECT_URI, MD_APP_STATE_PREFIX, MD_TESTS,
  assetRowId, isGraphAssetId, isMdAppState, isMdTestId, mdAppDialogUrl, mdAppReadiness, mdCodeExchangeUrl,
  mdErrorDetail, mdErrorMessage, mdGraphUrl, mdMessageBody, mdRedactUrl, mdResumeDecision, parseAssigned,
  parseBisuToken, parseBusinessId, parseMdInsights, parseMdWebhook, privateReplyOpen, publishRowId, readMdAppEnv,
  redactTokens, replyMode, signMdAppState, summariseTestResult, testNeeds, usesMdApp, validateMdPublish, verifyMdAppState,
} from '../app/lib/md-app-core'
import { signFbState } from '../app/lib/meta-fb-core'

afterEach(() => vi.unstubAllEnvs())

describe('env + readiness', () => {
  it('defaults the ids and redirect, reads the secret', () => {
    vi.stubEnv('MD_APP_ID', ''); vi.stubEnv('MD_APP_CONFIG_ID', ''); vi.stubEnv('MD_APP_REDIRECT_URI', '')
    vi.stubEnv('MD_APP_SECRET', ' s '); vi.stubEnv('MD_APP_WEBHOOK_VERIFY_TOKEN', '')
    const env = readMdAppEnv()
    expect(env).toEqual({ appId: '2326339324873915', configId: '1439306511741893', redirectUri: MD_APP_DEFAULT_REDIRECT_URI, appSecret: 's', verifyToken: null })
    expect(MD_APP_DEFAULT_APP_ID).toBe('2326339324873915'); expect(MD_APP_DEFAULT_CONFIG_ID).toBe('1439306511741893')
  })
  it('needs the secret AND the credentials key', () => {
    const env = { appId: 'a', configId: 'c', redirectUri: 'r', verifyToken: null }
    expect(mdAppReadiness({ ...env, appSecret: null }, true)).toMatchObject({ ok: false, reason: expect.stringContaining('MD_APP_SECRET') })
    expect(mdAppReadiness({ ...env, appSecret: 'x' }, false)).toMatchObject({ ok: false, reason: expect.stringContaining('CREDENTIALS_KEY') })
    expect(mdAppReadiness({ ...env, appSecret: 'x' }, true).ok).toBe(true)
  })
})

describe('state', () => {
  const now = 1_000_000
  it('round-trips, has its prefix, expires, rejects tampering and another secret', () => {
    const s = signMdAppState({ clientId: 'c1', userId: 'u1', now }, 'sec')
    expect(s.startsWith(MD_APP_STATE_PREFIX)).toBe(true)
    expect(isMdAppState(s)).toBe(true)
    expect(verifyMdAppState(s, 'sec', now + 1)).toMatchObject({ ok: true, payload: { clientId: 'c1', userId: 'u1' } })
    expect(verifyMdAppState(s, 'other', now + 1)).toEqual({ ok: false, reason: 'bad_signature' })
    expect(verifyMdAppState(s, 'sec', now + 11 * 60_000)).toEqual({ ok: false, reason: 'expired' })
    expect(verifyMdAppState(s.replace(/.$/, c => c === 'A' ? 'B' : 'A'), 'sec', now)).toMatchObject({ ok: false })
  })
  it('the old Facebook state never passes for MD App, nor the reverse prefix-free', () => {
    const fb = signFbState({ clientId: 'c1', userId: 'u1', now }, 'sec')
    expect(isMdAppState(fb)).toBe(false)
    expect(verifyMdAppState(fb, 'sec', now)).toEqual({ ok: false, reason: 'malformed' })
    expect(verifyMdAppState(MD_APP_STATE_PREFIX + fb, 'sec', now)).toEqual({ ok: false, reason: 'bad_signature' })
    expect(isMdAppState(null)).toBe(false)
  })
})

describe('URLs + redaction', () => {
  it('dialog: config_id, code, state, no scope', () => {
    const u = new URL(mdAppDialogUrl({ appId: 'A', configId: 'C', redirectUri: 'https://x/cb', state: 'S' }))
    expect(u.origin + u.pathname).toBe('https://www.facebook.com/dialog/oauth')
    expect(Object.fromEntries(u.searchParams)).toEqual({ client_id: 'A', config_id: 'C', redirect_uri: 'https://x/cb', response_type: 'code', state: 'S' })
  })
  it('graph is graph.facebook.com v27.0; the exchange is redacted', () => {
    expect(mdGraphUrl('/me', { fields: 'id' })).toBe('https://graph.facebook.com/v27.0/me?fields=id')
    const ex = mdCodeExchangeUrl({ appId: 'A', appSecret: 'SECRET', redirectUri: 'https://x/cb', code: 'CODE' })
    expect(ex).toContain('/v27.0/oauth/access_token')
    const red = mdRedactUrl(ex + '&access_token=EAAtoken')
    expect(red).not.toContain('SECRET'); expect(red).not.toContain('CODE'); expect(red).not.toContain('EAAtoken')
    expect(mdRedactUrl('nope')).toBe('(unparseable url)')
  })
  it('redacts tokens in text and in errors', () => {
    expect(redactTokens('bad EAAB1234567890abcdef token')).toBe('bad [token] token')
    expect(mdErrorMessage({ error: { message: 'Invalid EAAxxxxxxxxxxxxxxx', code: 190, error_subcode: 463 } })).toBe('Invalid [token] (code 190/463)')
    expect(mdErrorMessage(null, 500)).toBe('HTTP 500')
    expect(mdErrorDetail({ error: { code: '4', is_transient: true, error_user_msg: 'Slow down' } })).toEqual({ code: 4, subcode: null, transient: true, userMessage: 'Slow down' })
  })
})

describe('parsing', () => {
  it('BISU token and business id', () => {
    expect(parseBisuToken({ access_token: 'T', token_type: 'bearer' })).toEqual({ ok: true, token: 'T' })
    expect(parseBisuToken({ error: { message: 'bad code' } })).toMatchObject({ ok: false, error: 'bad code' })
    expect(parseBusinessId({ client_business_id: 123, id: '9' })).toBe('123')
    expect(parseBusinessId({})).toBeNull()
  })
  it('assigned assets: drops junk and duplicates, names by kind', () => {
    expect(parseAssigned('instagram', { data: [{ id: '1', username: 'a' }, { id: '1', username: 'a' }, { id: '../x' }] })).toEqual([{ kind: 'instagram', id: '1', name: 'a' }])
    expect(parseAssigned('ad_account', { data: [{ id: 'act_5', account_id: '5' }] })).toEqual([{ kind: 'ad_account', id: 'act_5', name: '5' }])
    expect(parseAssigned('page', null)).toEqual([])
    expect(isGraphAssetId('act_12')).toBe(true); expect(isGraphAssetId('12/x')).toBe(false)
    expect(assetRowId('c1', 'page', '7')).toBe('c1__page__7')
  })
  it('insights: total_value and summed values', () => {
    expect(parseMdInsights({ data: [{ name: 'reach', total_value: { value: 5 } }, { name: 'views', values: [{ value: 1 }, { value: 2 }] }, { name: 'x', values: [] }] }))
      .toEqual([{ metric: 'reach', value: 5 }, { metric: 'views', value: 3 }, { metric: 'x', value: null }])
  })
})

describe('the road + publishing', () => {
  it('only an active connection with the switch on uses MD App', () => {
    expect(usesMdApp(null)).toBe(false)
    expect(usesMdApp({ active: true, use_md_app: false })).toBe(false)
    expect(usesMdApp({ active: false, use_md_app: true })).toBe(false)
    expect(usesMdApp({ active: true, use_md_app: true })).toBe(true)
  })
  it('validates with the existing IG/FB rules (carousel 2–10)', () => {
    const items = Array.from({ length: 11 }, () => ({ type: 'image' as const, url: 'https://x/a.jpg' }))
    expect(validateMdPublish({ network: 'instagram', req: { kind: 'CAROUSEL', items } })).toMatch(/2 to 10/)
    expect(validateMdPublish({ network: 'instagram', req: { kind: 'IMAGE', imageUrl: 'https://x/a.jpg' } })).toBeNull()
    expect(validateMdPublish({ network: 'facebook', req: { kind: 'TEXT', message: ' ' } })).toMatch(/needs words/)
  })
  it('never twice', () => {
    expect(mdResumeDecision(null)).toBe('send')
    expect(mdResumeDecision({ sending_at: 'x' })).toBe('unknown')
    expect(mdResumeDecision({ sending_at: 'x', post_id: '1' })).toBe('done')
    expect(publishRowId('c1', 'k')).toBe(publishRowId('c1', 'k'))
    expect(publishRowId('c1', 'k')).not.toBe(publishRowId('c2', 'k'))
  })
})

describe('messaging', () => {
  const now = Date.parse('2026-11-06T00:00:00Z')
  it('reply mode: 24 h response, 7 days human agent, then closed', () => {
    expect(replyMode(new Date(now - 3_600_000).toISOString(), now)).toBe('response')
    expect(replyMode(new Date(now - 3 * 86_400_000).toISOString(), now)).toBe('human_agent')
    expect(replyMode(new Date(now - 8 * 86_400_000).toISOString(), now)).toBe('closed')
    expect(replyMode(null, now)).toBe('closed')
  })
  it('bodies: RESPONSE, HUMAN_AGENT tag, private reply by comment_id', () => {
    expect(mdMessageBody({ userId: '1' }, 'hi')).toEqual({ recipient: { id: '1' }, messaging_type: 'RESPONSE', message: { text: 'hi' } })
    expect(mdMessageBody({ userId: '1' }, 'hi', 'human_agent')).toEqual({ recipient: { id: '1' }, messaging_type: 'MESSAGE_TAG', tag: 'HUMAN_AGENT', message: { text: 'hi' } })
    expect(mdMessageBody({ commentId: '9' }, 'hi', 'human_agent')).toEqual({ recipient: { comment_id: '9' }, message: { text: 'hi' } })
  })
  it('private reply window is 7 days', () => {
    expect(privateReplyOpen(new Date(now - 6 * 86_400_000).toISOString(), now)).toBe(true)
    expect(privateReplyOpen(new Date(now - 8 * 86_400_000).toISOString(), now)).toBe(false)
  })
})

describe('webhook parsing', () => {
  it('instagram changes + messaging, page changes; others ignored; keys stable', () => {
    const body = { object: 'instagram', entry: [{ id: '17', time: 1_700_000_000, changes: [{ field: 'comments', value: { id: 'c' } }], messaging: [{ timestamp: 1_700_000_000_000, message: { text: 'x' } }] }] }
    const ev = parseMdWebhook(body)
    expect(ev.map(e => [e.object, e.accountId, e.field])).toEqual([['instagram', '17', 'comments'], ['instagram', '17', 'messages']])
    expect(parseMdWebhook(body)[0].key).toBe(ev[0].key)
    expect(parseMdWebhook({ object: 'page', entry: [{ id: '5', changes: [{ field: 'leadgen', value: {} }] }] })[0].field).toBe('leadgen')
    expect(parseMdWebhook({ object: 'user', entry: [] })).toEqual([])
  })
})

describe('test buttons', () => {
  it('known ids, the asset each needs, a safe summary', () => {
    expect(isMdTestId('ig_profile')).toBe(true); expect(isMdTestId('toString')).toBe(false)
    expect(testNeeds('ig_insights')).toBe('instagram'); expect(testNeeds('page_posts')).toBe('page'); expect(testNeeds('ad_accounts')).toBeNull()
    for (const t of Object.values(MD_TESTS)) expect(t.permissions.length).toBeGreaterThan(0)
    expect(summariseTestResult({ data: [1, 2] })).toBe('OK — 2 item(s)')
    expect(summariseTestResult({ success: true })).toBe('OK — subscribed')
    expect(summariseTestResult({ id: '1', access_token: 'EAAsecretsecretsecret' })).toBe('OK — id')
  })
})
