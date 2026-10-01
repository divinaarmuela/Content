import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * THE AGENCY'S OWN INSTAGRAM CONNECTION — the pure half (1 Oct 2026, branch
 * meta-instagram-login).
 *
 * "Instagram API with Instagram Login" on the Meta app "Social Scheduler"
 * (App ID 2142902776443404), Instagram app "Social Scheduler-IG". Everything
 * social still goes through Zernio; this is a second, direct road that nothing
 * in the posting flow uses yet. No I/O here: URL and parameter builders, the
 * signed OAuth `state`, the webhook signature, and parsing what Meta answers.
 * The I/O is app/lib/meta-ig.ts.
 *
 * Docs: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login
 */

/** Public: shown on Meta's dashboard as the Instagram app ID. The SECRET is env only. */
export const META_IG_DEFAULT_APP_ID = '843035665085991'
export const META_IG_DEFAULT_REDIRECT_URI = 'https://app.mdmmarketing.com.au/api/meta/instagram/callback'

export const META_IG_AUTHORIZE_URL = 'https://www.instagram.com/oauth/authorize'
export const META_IG_TOKEN_URL = 'https://api.instagram.com/oauth/access_token'
export const META_IG_GRAPH = 'https://graph.instagram.com'
/** Pinned so a Meta default-version change cannot move the ground under us. */
export const META_IG_GRAPH_VERSION = 'v23.0'

/** What the connect asks for. The first three are the use case's required set. */
export const META_IG_SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_comments',
  'instagram_business_manage_messages',
  'instagram_business_content_publish',
  'instagram_business_manage_insights',
] as const

/** A connect that takes longer than this to come back is refused. */
export const STATE_TTL_MS = 10 * 60 * 1000

/* ── env (read lazily, every name spelled out in full — CLAUDE.md trap 7) ── */

export type MetaIgEnv = {
  appId: string
  appSecret: string | null
  redirectUri: string
  verifyToken: string | null
}

export function readMetaIgEnv(): MetaIgEnv {
  const appId = process.env.META_IG_APP_ID?.trim() || META_IG_DEFAULT_APP_ID
  const appSecret = process.env.META_IG_APP_SECRET?.trim() || null
  const redirectUri = process.env.META_IG_REDIRECT_URI?.trim() || META_IG_DEFAULT_REDIRECT_URI
  const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN?.trim() || null
  return { appId, appSecret, redirectUri, verifyToken }
}

/* ── constant-time comparison ─────────────────────────────────────────── */

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  // timingSafeEqual throws on a length mismatch; compare against itself so the
  // time spent does not depend on where the strings differ
  if (ab.length !== bb.length) { timingSafeEqual(ab, ab); return false }
  return timingSafeEqual(ab, bb)
}

const b64url = (buf: Buffer | string) => Buffer.from(buf).toString('base64url')

/* ── the signed `state` ───────────────────────────────────────────────── */

export type StatePayload = {
  /** the client the account is being connected for */
  clientId: string
  /** the team user who pressed Connect */
  userId: string
  /** expiry, epoch ms */
  exp: number
  /** a random nonce, so two connects in the same millisecond differ */
  n: string
}

export function signState(
  input: { clientId: string; userId: string; now: number; ttlMs?: number; nonce?: string },
  secret: string,
): string {
  const payload: StatePayload = {
    clientId: input.clientId,
    userId: input.userId,
    exp: input.now + (input.ttlMs ?? STATE_TTL_MS),
    n: input.nonce ?? randomBytes(8).toString('hex'),
  }
  const body = b64url(JSON.stringify(payload))
  const sig = b64url(createHmac('sha256', secret).update(`ig-state.${body}`).digest())
  return `${body}.${sig}`
}

export type StateCheck =
  | { ok: true; payload: StatePayload }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' }

export function verifyState(state: unknown, secret: string, now: number): StateCheck {
  if (typeof state !== 'string' || state.length > 2048) return { ok: false, reason: 'malformed' }
  const parts = state.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'malformed' }
  const [body, sig] = parts
  const expected = b64url(createHmac('sha256', secret).update(`ig-state.${body}`).digest())
  if (!safeEqual(sig, expected)) return { ok: false, reason: 'bad_signature' }
  let payload: StatePayload
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (!payload || typeof payload.clientId !== 'string' || !payload.clientId
    || typeof payload.userId !== 'string' || typeof payload.exp !== 'number') {
    return { ok: false, reason: 'malformed' }
  }
  if (payload.exp <= now) return { ok: false, reason: 'expired' }
  return { ok: true, payload }
}

/* ── URL builders ─────────────────────────────────────────────────────── */

export function authorizeUrl(p: { appId: string; redirectUri: string; state: string; scopes?: readonly string[] }): string {
  const u = new URL(META_IG_AUTHORIZE_URL)
  u.searchParams.set('client_id', p.appId)
  u.searchParams.set('redirect_uri', p.redirectUri)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('scope', (p.scopes ?? META_IG_SCOPES).join(','))
  u.searchParams.set('state', p.state)
  return u.toString()
}

/** The form body of the code → short-lived token exchange (POST). */
export function codeExchangeBody(p: { appId: string; appSecret: string; redirectUri: string; code: string }): URLSearchParams {
  return new URLSearchParams({
    client_id: p.appId,
    client_secret: p.appSecret,
    grant_type: 'authorization_code',
    redirect_uri: p.redirectUri,
    // Instagram appends "#_" to the code it hands back; it is not part of it
    code: p.code.replace(/#_$/, ''),
  })
}

export function longLivedTokenUrl(p: { appSecret: string; shortToken: string }): string {
  const u = new URL(`${META_IG_GRAPH}/access_token`)
  u.searchParams.set('grant_type', 'ig_exchange_token')
  u.searchParams.set('client_secret', p.appSecret)
  u.searchParams.set('access_token', p.shortToken)
  return u.toString()
}

export function refreshTokenUrl(token: string): string {
  const u = new URL(`${META_IG_GRAPH}/refresh_access_token`)
  u.searchParams.set('grant_type', 'ig_refresh_token')
  u.searchParams.set('access_token', token)
  return u.toString()
}

/**
 * A versioned Graph URL. Meta's Instagram docs pass the token as the
 * `access_token` query parameter, so the caller adds it — and every error
 * message built from a URL goes through redactUrl first.
 */
export function graphUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
  const u = new URL(`${META_IG_GRAPH}/${META_IG_GRAPH_VERSION}/${path.replace(/^\//, '')}`)
  for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined) u.searchParams.set(k, String(v))
  return u.toString()
}

/** A URL with any token-shaped query parameter removed — for error messages. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url)
    for (const k of ['access_token', 'client_secret', 'code']) if (u.searchParams.has(k)) u.searchParams.set(k, 'REDACTED')
    return u.toString()
  } catch {
    return '(unparseable url)'
  }
}

/* ── response parsing ─────────────────────────────────────────────────── */

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

/** Meta's error envelope, as a short sentence that never carries a token. */
export function graphErrorMessage(json: unknown, status?: number): string {
  const j = (json ?? {}) as Record<string, any>
  const e = j.error
  if (e && typeof e === 'object') {
    const msg = typeof e.message === 'string' ? e.message : 'unknown error'
    const code = e.code != null ? ` (code ${e.code}${e.error_subcode != null ? `/${e.error_subcode}` : ''})` : ''
    return `${msg}${code}`.slice(0, 300)
  }
  if (typeof j.error_message === 'string') return j.error_message.slice(0, 300)
  if (typeof e === 'string') return e.slice(0, 300)
  return status ? `HTTP ${status}` : 'unknown error'
}

export type ShortToken = { accessToken: string; userId: string; permissions: string[] }

/**
 * The code exchange answers in one of two shapes, both seen in Meta's docs:
 * `{ data: [{ access_token, user_id, permissions: "a,b" }] }` and the older
 * flat `{ access_token, user_id, permissions: [..] }`.
 */
export function parseShortToken(json: unknown): Parsed<ShortToken> {
  const j = (json ?? {}) as Record<string, any>
  const row = Array.isArray(j.data) ? j.data[0] : j
  if (!row || typeof row.access_token !== 'string' || !row.access_token) {
    return { ok: false, error: graphErrorMessage(json) }
  }
  const perms = Array.isArray(row.permissions)
    ? row.permissions.map(String)
    : typeof row.permissions === 'string' ? row.permissions.split(',').map((s: string) => s.trim()).filter(Boolean) : []
  return { ok: true, value: { accessToken: row.access_token, userId: String(row.user_id ?? ''), permissions: perms } }
}

export type LongToken = { accessToken: string; expiresIn: number | null }

export function parseLongToken(json: unknown): Parsed<LongToken> {
  const j = (json ?? {}) as Record<string, any>
  if (typeof j.access_token !== 'string' || !j.access_token) return { ok: false, error: graphErrorMessage(json) }
  const exp = Number(j.expires_in)
  return { ok: true, value: { accessToken: j.access_token, expiresIn: Number.isFinite(exp) && exp > 0 ? exp : null } }
}

export type IgMe = { userId: string; username: string | null; accountType: string | null }

/**
 * `/me`. `user_id` is the Instagram professional account id — the id webhooks
 * name in `entry.id` — and is the one the row is keyed by. `id` is app-scoped
 * and only a fallback.
 */
export function parseMe(json: unknown): Parsed<IgMe> {
  const j = (json ?? {}) as Record<string, any>
  const id = j.user_id ?? j.id
  if (id == null || id === '') return { ok: false, error: graphErrorMessage(json) }
  return {
    ok: true,
    value: {
      userId: String(id),
      username: typeof j.username === 'string' ? j.username : null,
      accountType: typeof j.account_type === 'string' ? j.account_type : null,
    },
  }
}

export function expiresAtFrom(now: number, expiresIn: number | null): string | null {
  return expiresIn ? new Date(now + expiresIn * 1000).toISOString() : null
}

/* ── the refresh job's choice ─────────────────────────────────────────── */

export const DAY_MS = 24 * 60 * 60 * 1000
export const REFRESH_MIN_AGE_MS = DAY_MS        // Meta refuses to refresh a token under 24 h old
export const REFRESH_WINDOW_MS = 15 * DAY_MS    // refresh once inside 15 days of expiry

export type RefreshRow = {
  id: string
  status: string
  token_expires_at: string | null
  connected_at: string
  refreshed_at: string | null
}

/**
 * Which tokens the daily job refreshes, and which it can only mark expired.
 * Only `active` rows are considered. A token already past its expiry cannot be
 * refreshed (Meta refuses), so it is marked expired and someone reconnects.
 * A token with no known expiry is refreshed once it is old enough, which
 * learns its expiry.
 */
export function selectForRefresh<T extends RefreshRow>(rows: T[], now: number): { refresh: T[]; expire: T[] } {
  const refresh: T[] = []
  const expire: T[] = []
  for (const r of rows) {
    if (r.status !== 'active') continue
    const exp = r.token_expires_at ? Date.parse(r.token_expires_at) : NaN
    if (Number.isFinite(exp) && exp <= now) { expire.push(r); continue }
    const issued = Date.parse(r.refreshed_at ?? r.connected_at)
    const oldEnough = Number.isFinite(issued) && now - issued >= REFRESH_MIN_AGE_MS
    if (!oldEnough) continue
    if (!Number.isFinite(exp) || exp - now <= REFRESH_WINDOW_MS) refresh.push(r)
  }
  return { refresh, expire }
}

/* ── webhooks ─────────────────────────────────────────────────────────── */

/** GET handshake: the challenge to echo, or null to refuse. */
export function handshakeChallenge(params: URLSearchParams, verifyToken: string): string | null {
  const mode = params.get('hub.mode')
  const token = params.get('hub.verify_token')
  const challenge = params.get('hub.challenge')
  if (mode !== 'subscribe' || token == null || challenge == null) return null
  return safeEqual(token, verifyToken) ? challenge : null
}

/** X-Hub-Signature-256: `sha256=<hex HMAC-SHA256 of the raw body with the app secret>`. */
export function verifyWebhookSignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header) return false
  const m = /^sha256=([a-f0-9]{64})$/i.exec(header.trim())
  if (!m) return false
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
  return safeEqual(m[1].toLowerCase(), expected)
}

/** One delivery's id: the same body delivered twice is the same delivery. */
export function deliveryIdOf(rawBody: string): string {
  return createHash('sha256').update(rawBody, 'utf8').digest('hex').slice(0, 40)
}

/** The only fields stored. Everything else Meta sends is acknowledged and dropped. */
export const STORED_KINDS = ['comments', 'mentions', 'messages'] as const
export type StoredKind = typeof STORED_KINDS[number]

export type WebhookEvent = {
  key: string
  igUserId: string
  kind: StoredKind
  payload: unknown
  occurredAt: string | null
}

const isoFrom = (t: unknown): string | null => {
  const n = Number(t)
  if (!Number.isFinite(n) || n <= 0) return null
  // entry.time is seconds; messaging timestamps are milliseconds
  return new Date(n < 1e12 ? n * 1000 : n).toISOString()
}

export function webhookEventKey(kind: string, igUserId: string, payload: unknown): string {
  const h = createHash('sha256').update(`${kind}|${igUserId}|${JSON.stringify(payload)}`).digest('hex').slice(0, 32)
  return `${kind}_${h}`
}

/**
 * Comments, mentions and messages out of an Instagram webhook body.
 * `{ object: 'instagram', entry: [{ id, time, changes: [{ field, value }], messaging: [...] }] }`
 */
export function parseWebhookEvents(body: unknown): WebhookEvent[] {
  const b = (body ?? {}) as Record<string, any>
  if (b.object !== 'instagram' || !Array.isArray(b.entry)) return []
  const out: WebhookEvent[] = []
  for (const entry of b.entry) {
    if (!entry || entry.id == null) continue
    const igUserId = String(entry.id)
    for (const ch of Array.isArray(entry.changes) ? entry.changes : []) {
      const field = ch?.field
      if (field !== 'comments' && field !== 'mentions') continue
      const payload = ch.value ?? null
      out.push({ key: webhookEventKey(field, igUserId, payload), igUserId, kind: field, payload, occurredAt: isoFrom(entry.time) })
    }
    for (const m of Array.isArray(entry.messaging) ? entry.messaging : []) {
      if (!m) continue
      out.push({ key: webhookEventKey('messages', igUserId, m), igUserId, kind: 'messages', payload: m, occurredAt: isoFrom(m.timestamp ?? entry.time) })
    }
  }
  return out
}

/* ── publishing ───────────────────────────────────────────────────────── */

export type PublishItem = { type: 'image' | 'video'; url: string }
export type PublishRequest =
  | { kind: 'IMAGE'; imageUrl: string; caption?: string }
  | { kind: 'REELS'; videoUrl: string; caption?: string; coverUrl?: string; shareToFeed?: boolean }
  | { kind: 'STORIES'; media: PublishItem }
  | { kind: 'CAROUSEL'; items: PublishItem[]; caption?: string }

/** The parameters of `POST /{ig-user-id}/media` for one container. */
export function containerParams(req: PublishRequest): Record<string, string> {
  switch (req.kind) {
    case 'IMAGE':
      return { image_url: req.imageUrl, ...(req.caption ? { caption: req.caption } : {}) }
    case 'REELS':
      return {
        media_type: 'REELS', video_url: req.videoUrl,
        ...(req.caption ? { caption: req.caption } : {}),
        ...(req.coverUrl ? { cover_url: req.coverUrl } : {}),
        ...(req.shareToFeed === false ? { share_to_feed: 'false' } : {}),
      }
    case 'STORIES':
      return req.media.type === 'video'
        ? { media_type: 'STORIES', video_url: req.media.url }
        : { media_type: 'STORIES', image_url: req.media.url }
    case 'CAROUSEL':
      throw new Error('a carousel is built from carouselItemParams + carouselParentParams')
  }
}

export function carouselItemParams(item: PublishItem): Record<string, string> {
  return item.type === 'video'
    ? { media_type: 'VIDEO', video_url: item.url, is_carousel_item: 'true' }
    : { image_url: item.url, is_carousel_item: 'true' }
}

export function carouselParentParams(childIds: string[], caption?: string): Record<string, string> {
  return { media_type: 'CAROUSEL', children: childIds.join(','), ...(caption ? { caption } : {}) }
}

/** Instagram's limits, refused here rather than by a half-made post. */
export function validatePublish(req: PublishRequest): string | null {
  if (req.kind === 'CAROUSEL' && (req.items.length < 2 || req.items.length > 10)) {
    return 'A carousel takes 2 to 10 pictures or videos'
  }
  const caption = 'caption' in req ? req.caption : undefined
  if (caption && caption.length > 2200) return 'A caption is at most 2,200 characters'
  return null
}

/** `GET /{ig-user-id}/content_publishing_limit?fields=quota_usage,config` → room left, or null if unreadable. */
export function publishingRoom(json: unknown): { used: number; total: number } | null {
  const row = Array.isArray((json as any)?.data) ? (json as any).data[0] : null
  if (!row) return null
  const used = Number(row.quota_usage)
  const total = Number(row.config?.quota_total)
  if (!Number.isFinite(used) || !Number.isFinite(total)) return null
  return { used, total }
}

/** A container's `status_code`: FINISHED is ready, ERROR/EXPIRED is final, anything else waits. */
export function containerState(statusCode: unknown): 'ready' | 'failed' | 'waiting' {
  if (statusCode === 'FINISHED' || statusCode === 'PUBLISHED') return 'ready'
  if (statusCode === 'ERROR' || statusCode === 'EXPIRED') return 'failed'
  return 'waiting'
}

/* ── messaging ────────────────────────────────────────────────────────── */

/**
 * The body of `POST /me/messages`. A private reply addresses a COMMENT; a
 * message addresses a person (IGSID). The HUMAN_AGENT tag (7 days instead of
 * 24 hours) is only ever added when the caller asked AND the env flag allows.
 */
export function messageBody(
  to: { commentId: string } | { userId: string },
  text: string,
  opts: { humanAgent?: boolean } = {},
): Record<string, unknown> {
  const recipient = 'commentId' in to ? { comment_id: to.commentId } : { id: to.userId }
  return {
    recipient,
    message: { text },
    ...(opts.humanAgent && 'userId' in to ? { messaging_type: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' } : {}),
  }
}
