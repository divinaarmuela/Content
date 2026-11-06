import { createHash, createHmac, randomBytes } from 'node:crypto'
import { safeEqual, type GraphErrorDetail, type PublishRequest, validatePublish } from './meta-ig-core'
import { validateFbPublish, type FbPublishRequest, PAGE_METRICS, FB_POST_METRICS } from './meta-fb-core'

/**
 * MD APP — THE PURE HALF (6 Nov 2026). Meta app "MD App" (App ID 2326339324873915, owned by the verified
 * business MD Media), Instagram API with UNIFIED LOGIN (Facebook Login for Business, configuration
 * "Connect client accounts", config_id 1439306511741893, System-user access token, never expires).
 *
 * A SEPARATE, OPT-IN ROAD. Zernio stays the default for every client; the old Instagram-Login app
 * (meta-ig-*) and the old Facebook app (meta-fb-*) are untouched. Only md_app_connections.use_md_app = true
 * (a super admin, per client) puts a client on this road. No I/O here — the Graph calls and the database are
 * md-app.ts.
 *
 * DOCS READ 6 Nov 2026 (developers.facebook.com/documentation/instagram-platform/…, the .md pages):
 *   - instagram-api-with-unified-login/get-started.md — dialog
 *     "https://www.facebook.com/dialog/oauth?client_id=…&config_id=…&redirect_uri=…&response_type=code";
 *     no `scope` (the configuration carries the permissions); "Your app doesn't receive an access token directly
 *     from the login flow." Code exchange: "GET https://graph.facebook.com/v27.0/oauth/access_token?client_id=
 *     …&client_secret=…&code=…" → "a Business Integration System User Access Token". The page shows NO
 *     redirect_uri on the exchange; Facebook Login's manual flow requires the same redirect_uri, so we send it
 *     (UNVERIFIED for Unified — if Meta refuses, drop it). `state` is NOT mentioned; we send it (standard OAuth).
 *   - same page — "GET /me?fields=client_business_id" ("/me represents the business integration system user");
 *     "GET /me/assigned_instagram_accounts" fields id,username (instagram_basic); "GET /me/adaccounts"
 *     (ads_read or ads_management). Pages: NOT on the page — we use GET /me/accounts (the Page list for a
 *     user/system user, fields id,name). UNVERIFIED for a BISU token.
 *   - instagram-api-with-unified-login.md — "Instagram User access tokens and graph.instagram.com don't work
 *     with the Instagram API with Unified Login." Everything here is graph.facebook.com/v27.0.
 *   - content-publishing.md — POST /{ig-id}/media (image_url | video_url, media_type VIDEO/REELS/STORIES,
 *     is_carousel_item, CAROUSEL children), POST /{ig-id}/media_publish creation_id, GET /{container}?fields=
 *     status_code (FINISHED/IN_PROGRESS/ERROR/EXPIRED/PUBLISHED). Our UI caps a carousel at 10.
 *   - comment-moderation.md — GET /{media}/comments, POST /{comment}/replies message, POST /{comment} (hide;
 *     the parameter name `hide` is not in the fetched text — taken from the Graph reference used by meta-ig),
 *     DELETE /{comment}.
 *   - private-replies.md — "POST https://graph.facebook.com/<API_VERSION>/<APP_USERS_IG_ID>/messages" with
 *     {"recipient":{"comment_id":…},"message":{"text":…}}; "Only one message can be sent to the commenter";
 *     "within 7 days of the creation time of the comment".
 *   - insights.md — GET /{ig-id}/insights, GET /{media}/insights; "Some metrics are not available on Instagram
 *     accounts with fewer than 100 followers." The metric NAMES below (reach, follower_count,
 *     follows_and_unfollows, profile_views, accounts_engaged, total_interactions, views; media reach, likes,
 *     comments, saved, shares, total_interactions, views) come from the Graph insights reference as used since
 *     v22 (impressions withdrawn) — NOT re-verified on the pages read today.
 *   - webhooks/fields.md — Unified fields: comments, live_comments, mentions, message_reactions, messages,
 *     messaging_postbacks, messaging_referral, messaging_seen, story_insights.
 *     webhooks/setup.md — "POST https://graph.facebook.com/v27.0/<INSTAGRAM_ACCOUNT_ID>/subscribed_apps" with
 *     subscribed_fields and the BISU token; X-Hub-Signature-256 "sha256=<signature>" with the App Secret;
 *     hub.mode / hub.verify_token / hub.challenge.
 *   - HUMAN_AGENT: the Instagram Login messaging page says only that the app "can tag the response to use the
 *     separate 7-day Human Agent window"; the tag syntax (messaging_type MESSAGE_TAG, tag HUMAN_AGENT) is the
 *     Messenger Platform's, NOT re-verified for Unified.
 *   - Page token via GET /{page-id}?fields=access_token with the BISU token: NOT on any page read. UNVERIFIED.
 */

export const MD_APP_DEFAULT_APP_ID = '2326339324873915'
export const MD_APP_DEFAULT_CONFIG_ID = '1439306511741893'
/** One of the two redirect URIs registered on MD App (6 Nov 2026). The old Facebook app uses the same path;
 * the callback tells the two apart by the state's prefix (MD_APP_STATE_PREFIX). */
export const MD_APP_DEFAULT_REDIRECT_URI = 'https://app.mdmmarketing.com.au/api/meta/facebook/callback'
export const MD_APP_GRAPH = 'https://graph.facebook.com'
export const MD_APP_GRAPH_VERSION = 'v27.0'
export const MD_APP_DIALOG_URL = 'https://www.facebook.com/dialog/oauth'
export const MD_APP_STATE_PREFIX = 'mdapp1.'
export const MD_APP_STATE_TTL_MS = 10 * 60 * 1000

/** What the "Connect client accounts" configuration grants (set on Meta's side; config_id replaces scope). */
export const MD_APP_PERMISSIONS = [
  'ads_management', 'ads_read', 'business_management', 'leads_retrieval', 'instagram_basic',
  'instagram_content_publish', 'instagram_manage_comments', 'instagram_manage_insights', 'instagram_manage_messages',
  'pages_manage_ads', 'pages_manage_engagement', 'pages_manage_metadata', 'pages_manage_posts', 'pages_messaging',
  'pages_read_engagement', 'pages_read_user_content', 'pages_show_list', 'publish_video', 'read_insights',
] as const

/* ── env (every name spelled out — CLAUDE.md trap 7) ──────────────────── */

export type MdAppEnv = { appId: string; appSecret: string | null; configId: string; redirectUri: string; verifyToken: string | null }

export function readMdAppEnv(): MdAppEnv {
  return {
    appId: process.env.MD_APP_ID?.trim() || MD_APP_DEFAULT_APP_ID,
    appSecret: process.env.MD_APP_SECRET?.trim() || null,
    configId: process.env.MD_APP_CONFIG_ID?.trim() || MD_APP_DEFAULT_CONFIG_ID,
    redirectUri: process.env.MD_APP_REDIRECT_URI?.trim() || MD_APP_DEFAULT_REDIRECT_URI,
    verifyToken: process.env.MD_APP_WEBHOOK_VERIFY_TOKEN?.trim() || null,
  }
}

export type MdAppReady = { ok: true; env: MdAppEnv & { appSecret: string } } | { ok: false; reason: string }

export function mdAppReadiness(env: MdAppEnv, credentialsKeySet: boolean): MdAppReady {
  if (!env.appSecret) return { ok: false, reason: 'MD App is not set up yet: MD_APP_SECRET is not set.' }
  if (!credentialsKeySet) return { ok: false, reason: 'MD App is not set up yet: CREDENTIALS_KEY is not set, so the token could not be stored safely.' }
  return { ok: true, env: { ...env, appSecret: env.appSecret } }
}

/* ── signed state (own prefix + own HMAC label, so no other app's state passes) ── */

export type MdAppStatePayload = { clientId: string; userId: string; exp: number; n: string }
const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url')
const stateSig = (body: string, secret: string) => b64url(createHmac('sha256', secret).update(`mdapp-state.${body}`).digest())

export function signMdAppState(input: { clientId: string; userId: string; now: number; ttlMs?: number; nonce?: string }, secret: string): string {
  const payload: MdAppStatePayload = {
    clientId: input.clientId, userId: input.userId,
    exp: input.now + (input.ttlMs ?? MD_APP_STATE_TTL_MS), n: input.nonce ?? randomBytes(8).toString('hex'),
  }
  const body = b64url(JSON.stringify(payload))
  return `${MD_APP_STATE_PREFIX}${body}.${stateSig(body, secret)}`
}

export function isMdAppState(state: unknown): boolean {
  return typeof state === 'string' && state.startsWith(MD_APP_STATE_PREFIX)
}

export type MdAppStateCheck = { ok: true; payload: MdAppStatePayload } | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' }

export function verifyMdAppState(state: unknown, secret: string, now: number): MdAppStateCheck {
  if (typeof state !== 'string' || state.length > 2048 || !state.startsWith(MD_APP_STATE_PREFIX)) return { ok: false, reason: 'malformed' }
  const parts = state.slice(MD_APP_STATE_PREFIX.length).split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'malformed' }
  if (!safeEqual(parts[1], stateSig(parts[0], secret))) return { ok: false, reason: 'bad_signature' }
  let p: MdAppStatePayload
  try { p = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) } catch { return { ok: false, reason: 'malformed' } }
  if (!p || typeof p.clientId !== 'string' || !p.clientId || typeof p.userId !== 'string' || typeof p.exp !== 'number') return { ok: false, reason: 'malformed' }
  if (p.exp <= now) return { ok: false, reason: 'expired' }
  return { ok: true, payload: p }
}

/* ── URLs ─────────────────────────────────────────────────────────────── */

export function mdAppDialogUrl(p: { appId: string; configId: string; redirectUri: string; state: string }): string {
  const u = new URL(MD_APP_DIALOG_URL)
  u.searchParams.set('client_id', p.appId)
  u.searchParams.set('config_id', p.configId)
  u.searchParams.set('redirect_uri', p.redirectUri)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('state', p.state)
  return u.toString()
}

export function mdGraphUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
  const u = new URL(`${MD_APP_GRAPH}/${MD_APP_GRAPH_VERSION}/${path.replace(/^\//, '')}`)
  for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined) u.searchParams.set(k, String(v))
  return u.toString()
}

export function mdCodeExchangeUrl(p: { appId: string; appSecret: string; redirectUri: string; code: string }): string {
  return mdGraphUrl('oauth/access_token', { client_id: p.appId, client_secret: p.appSecret, redirect_uri: p.redirectUri, code: p.code })
}

export function mdAppsecretProof(token: string, appSecret: string): string {
  return createHmac('sha256', appSecret).update(token, 'utf8').digest('hex')
}

const SECRET_PARAMS = ['access_token', 'client_secret', 'code', 'appsecret_proof', 'fb_exchange_token', 'input_token']

export function mdRedactUrl(url: string): string {
  try {
    const u = new URL(url)
    for (const k of SECRET_PARAMS) if (u.searchParams.has(k)) u.searchParams.set(k, 'REDACTED')
    return u.toString()
  } catch { return '(unparseable url)' }
}

/** Any token-shaped text (EAA… user/system tokens, IG… tokens) replaced — for anything that may be shown or logged. */
export function redactTokens(text: string): string {
  return text.replace(/\b(EAA|IGQ|IGAA)[A-Za-z0-9_-]{10,}/g, '[token]')
}

/* ── what Meta answers ────────────────────────────────────────────────── */

export function mdErrorMessage(json: unknown, status?: number): string {
  const e = ((json ?? {}) as Record<string, any>).error
  if (e && typeof e === 'object') {
    const msg = typeof e.message === 'string' ? e.message : 'unknown error'
    const code = e.code != null ? ` (code ${e.code}${e.error_subcode != null ? `/${e.error_subcode}` : ''})` : ''
    return redactTokens(`${msg}${code}`).slice(0, 300)
  }
  return status ? `HTTP ${status}` : 'unknown error'
}

export function mdErrorDetail(json: unknown): GraphErrorDetail {
  const e = ((json ?? {}) as Record<string, any>).error
  if (!e || typeof e !== 'object') return { code: null, subcode: null, transient: false, userMessage: null }
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null)
  const um = typeof e.error_user_msg === 'string' && e.error_user_msg.trim() ? redactTokens(e.error_user_msg.trim()).slice(0, 300) : null
  return { code: num(e.code), subcode: num(e.error_subcode), transient: e.is_transient === true, userMessage: um }
}

export function parseBisuToken(json: unknown): { ok: true; token: string } | { ok: false; error: string } {
  const j = (json ?? {}) as Record<string, any>
  if (typeof j.access_token !== 'string' || !j.access_token) return { ok: false, error: mdErrorMessage(json) }
  return { ok: true, token: j.access_token }
}

export function parseBusinessId(json: unknown): string | null {
  const v = ((json ?? {}) as Record<string, any>).client_business_id
  return v == null || v === '' ? null : String(v)
}

export const ASSET_KINDS = ['instagram', 'page', 'ad_account'] as const
export type AssetKind = typeof ASSET_KINDS[number]
export type AssignedAsset = { kind: AssetKind; id: string; name: string | null }

/** `{ data: [...] }` → assets. IG: id,username. Page: id,name. Ad account: id (act_…), name or account_id. */
export function parseAssigned(kind: AssetKind, json: unknown): AssignedAsset[] {
  const rows = Array.isArray((json as any)?.data) ? (json as any).data : []
  const out: AssignedAsset[] = []
  const seen = new Set<string>()
  for (const r of rows) {
    if (!r || r.id == null || !isGraphAssetId(String(r.id))) continue
    const id = String(r.id)
    if (seen.has(id)) continue
    seen.add(id)
    const name = kind === 'instagram' ? r.username : kind === 'ad_account' ? (r.name ?? r.account_id) : r.name
    out.push({ kind, id, name: typeof name === 'string' && name ? name : null })
  }
  return out
}

/** Numeric Graph ids, or an ad account's `act_<digits>`. Anything else never becomes part of a path. */
export function isGraphAssetId(v: unknown): v is string {
  return typeof v === 'string' && /^(act_)?\d{1,30}$/.test(v)
}

export function assetRowId(clientId: string, kind: AssetKind, assetId: string): string {
  return `${clientId}__${kind}__${assetId}`
}

/* ── the road: which clients use MD App ───────────────────────────────── */

/** THE SINGLE FLAG. Anything but an active connection with use_md_app === true is the existing road (Zernio). */
export function usesMdApp(conn: { active?: unknown; use_md_app?: unknown } | null | undefined): boolean {
  return !!conn && conn.active === true && conn.use_md_app === true
}

/* ── publishing (Instagram request shapes reused from meta-ig-core, Facebook from meta-fb-core) ── */

export type MdPublishRequest =
  | { network: 'instagram'; req: PublishRequest }
  | { network: 'facebook'; req: FbPublishRequest }

export function validateMdPublish(r: MdPublishRequest): string | null {
  return r.network === 'instagram' ? validatePublish(r.req) : validateFbPublish(r.req)
}

export type MdPublishState = { sending_at?: string | null; post_id?: string | null }

/** The never-twice rule (meta-fb-publish's): done if posted; 'unknown' if a send began and nothing came back. */
export function mdResumeDecision(s: MdPublishState | null | undefined): 'done' | 'unknown' | 'send' {
  if (s?.post_id) return 'done'
  if (s?.sending_at) return 'unknown'
  return 'send'
}

/** A stable id for one publish request, so pressing twice is the same row. */
export function publishRowId(clientId: string, key: string): string {
  return createHash('sha256').update(`${clientId}\u0000${key}`).digest('hex').slice(0, 32)
}

/* ── insights ─────────────────────────────────────────────────────────── */

/** Account-level, period=day, metric_type=total_value (UNVERIFIED names — see the header). */
export const IG_ACCOUNT_METRICS = ['reach', 'follows_and_unfollows', 'profile_views', 'accounts_engaged', 'total_interactions', 'views'] as const
export const IG_MEDIA_METRICS = ['reach', 'likes', 'comments', 'saved', 'shares', 'total_interactions', 'views'] as const
export { PAGE_METRICS, FB_POST_METRICS }

export type MdInsight = { metric: string; value: number | null }

/** `{ data: [{ name, total_value: { value } | values: [{ value }] }] }` → one number per metric (summed over values). */
export function parseMdInsights(json: unknown): MdInsight[] {
  const rows = Array.isArray((json as any)?.data) ? (json as any).data : []
  const out: MdInsight[] = []
  for (const r of rows) {
    if (!r || typeof r.name !== 'string') continue
    let value: number | null = null
    if (r.total_value && typeof r.total_value.value === 'number') value = r.total_value.value
    else if (Array.isArray(r.values)) {
      const nums = r.values.map((v: any) => v?.value).filter((v: unknown): v is number => typeof v === 'number')
      value = nums.length ? nums.reduce((a: number, b: number) => a + b, 0) : null
    }
    out.push({ metric: r.name, value })
  }
  return out
}

/* ── messaging ────────────────────────────────────────────────────────── */

export const MESSAGE_WINDOW_MS = 24 * 60 * 60 * 1000
export const HUMAN_AGENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
export const PRIVATE_REPLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/** Which way a reply may go now: inside 24 h a plain RESPONSE; 24 h–7 days only with the HUMAN_AGENT tag; after, not at all. */
export function replyMode(lastFromThemAt: string | null | undefined, now: number): 'response' | 'human_agent' | 'closed' {
  const t = lastFromThemAt ? Date.parse(lastFromThemAt) : NaN
  if (!Number.isFinite(t)) return 'closed'
  const age = now - t
  if (age < 0) return 'response'
  if (age <= MESSAGE_WINDOW_MS) return 'response'
  if (age <= HUMAN_AGENT_WINDOW_MS) return 'human_agent'
  return 'closed'
}

/** POST /{ig-id|page-id}/messages body. A person: recipient.id; a private reply: recipient.comment_id. */
export function mdMessageBody(to: { userId: string } | { commentId: string }, text: string, mode: 'response' | 'human_agent' = 'response'): Record<string, unknown> {
  if ('commentId' in to) return { recipient: { comment_id: to.commentId }, message: { text } }
  return mode === 'human_agent'
    ? { recipient: { id: to.userId }, messaging_type: 'MESSAGE_TAG', tag: 'HUMAN_AGENT', message: { text } }
    : { recipient: { id: to.userId }, messaging_type: 'RESPONSE', message: { text } }
}

export function privateReplyOpen(commentCreatedAt: string | null | undefined, now: number): boolean {
  const t = commentCreatedAt ? Date.parse(commentCreatedAt) : NaN
  return Number.isFinite(t) && now - t <= PRIVATE_REPLY_WINDOW_MS
}

/* ── webhooks ─────────────────────────────────────────────────────────── */

export const IG_WEBHOOK_FIELDS = ['comments', 'mentions', 'messages', 'message_reactions', 'messaging_seen', 'story_insights'] as const
export const PAGE_WEBHOOK_FIELDS_MD = ['feed', 'messages', 'leadgen'] as const

export type MdWebhookEvent = { key: string; object: 'instagram' | 'page'; accountId: string; field: string; payload: unknown; occurredAt: string | null }

const eventKey = (object: string, accountId: string, field: string, payload: unknown) =>
  createHash('sha256').update(`${object}\u0000${accountId}\u0000${field}\u0000${JSON.stringify(payload ?? null)}`).digest('hex').slice(0, 40)

/** object instagram|page; entry[].changes[] (field,value) and entry[].messaging[] (field 'messages'). */
export function parseMdWebhook(body: unknown): MdWebhookEvent[] {
  const b = (body ?? {}) as Record<string, any>
  if (b.object !== 'instagram' && b.object !== 'page') return []
  const out: MdWebhookEvent[] = []
  for (const entry of Array.isArray(b.entry) ? b.entry : []) {
    if (!entry || entry.id == null) continue
    const accountId = String(entry.id)
    const at = typeof entry.time === 'number' ? new Date(entry.time > 1e12 ? entry.time : entry.time * 1000).toISOString() : null
    for (const c of Array.isArray(entry.changes) ? entry.changes : []) {
      if (!c || typeof c.field !== 'string') continue
      out.push({ key: eventKey(b.object, accountId, c.field, c.value), object: b.object, accountId, field: c.field, payload: c.value ?? null, occurredAt: at })
    }
    for (const m of Array.isArray(entry.messaging) ? entry.messaging : []) {
      if (!m) continue
      out.push({ key: eventKey(b.object, accountId, 'messages', m), object: b.object, accountId, field: 'messages', payload: m, occurredAt: typeof m.timestamp === 'number' ? new Date(m.timestamp).toISOString() : at })
    }
  }
  return out
}

/* ── the test buttons: ONE real call each, for Meta's "successful API calls" before App Review ── */

export const MD_TESTS = {
  ig_profile: { label: 'Read Instagram profile', permissions: ['instagram_basic'] },
  ig_media: { label: 'List Instagram posts', permissions: ['instagram_basic'] },
  ig_insights: { label: 'Read Instagram insights', permissions: ['instagram_manage_insights'] },
  ig_comments: { label: 'List comments on the latest post', permissions: ['instagram_manage_comments'] },
  ig_conversations: { label: 'List Instagram conversations', permissions: ['instagram_manage_messages'] },
  ig_publish_limit: { label: 'Read Instagram posting allowance', permissions: ['instagram_content_publish'] },
  ig_subscribe: { label: 'Subscribe Instagram to webhooks', permissions: ['instagram_manage_comments', 'instagram_manage_messages', 'instagram_manage_insights'] },
  pages: { label: 'List Pages', permissions: ['pages_show_list'] },
  page_posts: { label: 'Read Page posts', permissions: ['pages_read_engagement', 'pages_read_user_content'] },
  page_insights: { label: 'Read Page insights', permissions: ['read_insights'] },
  page_conversations: { label: 'List Messenger conversations', permissions: ['pages_messaging'] },
  page_subscribe: { label: 'Subscribe Page to webhooks', permissions: ['pages_manage_metadata'] },
  page_leadforms: { label: 'List lead forms', permissions: ['leads_retrieval'] },
  ad_accounts: { label: 'List ad accounts', permissions: ['ads_read'] },
  business: { label: 'Read business portfolio', permissions: ['business_management'] },
} as const satisfies Record<string, { label: string; permissions: readonly string[] }>

export type MdTestId = keyof typeof MD_TESTS

export function isMdTestId(v: unknown): v is MdTestId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(MD_TESTS, v)
}

/** Which picked asset a test needs. */
export function testNeeds(id: MdTestId): AssetKind | null {
  if (id.startsWith('ig_')) return 'instagram'
  if (id.startsWith('page_')) return 'page'
  return null
}

/** A test result safe to show: counts and ids only, never a token. */
export function summariseTestResult(json: unknown): string {
  const j = (json ?? {}) as Record<string, any>
  if (Array.isArray(j.data)) return `OK — ${j.data.length} item(s)`
  if (j.success === true) return 'OK — subscribed'
  const keys = Object.keys(j).filter(k => k !== 'access_token')
  return keys.length ? `OK — ${redactTokens(keys.slice(0, 6).join(', '))}` : 'OK'
}
