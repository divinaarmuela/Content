import { createHash, createHmac, randomBytes } from 'node:crypto'
import { safeEqual, type GraphErrorDetail } from './meta-ig-core'

/**
 * THE AGENCY'S OWN FACEBOOK PAGE CONNECTION — the pure half (6 Nov 2026).
 *
 * Facebook Login for Business on the Meta app "Social Scheduler" (App ID 2142902776443404), configuration
 * "Connect Facebook Page" (config_id 1428692675563072, User access token). Mirrors the Instagram road
 * (meta-ig-core.ts). No I/O here: env, the signed `state`, URL builders, parsing what Meta answers, the
 * publishing rule and request, the inbox's shapes and the Page webhook. The Graph calls are
 * meta-fb-client.ts; MD Media's wiring is meta-fb.ts / meta-fb-publish.ts / meta-fb-inbox.ts.
 *
 * Zernio stays the default everywhere: nothing here runs for a client whose `facebook_via_meta` is off.
 *
 * Docs read 6 Nov 2026 (developers.facebook.com):
 *   - docs/facebook-login/facebook-login-for-business — with config_id, do not pass `scope`; the code is
 *     exchanged server-to-server at graph.facebook.com/{v}/oauth/access_token (client_id, client_secret, code;
 *     the manual flow also needs the same redirect_uri). The page shows v27.0; we stay pinned on v23.0, which
 *     is still supported.
 *   - docs/pages-api/posts — POST /{page-id}/feed (message, link), POST /{page-id}/photos (url), reading
 *     GET /{page-id}/feed. Page tokens; tasks CREATE_CONTENT / MANAGE / MODERATE.
 *   - docs/pages-api/comments-mentions, docs/graph-api/reference/comment — GET /{post-id}/comments,
 *     POST /{comment-id} is_hidden (Page comments only), DELETE /{comment-id}.
 *   - docs/graph-api/reference/page/subscribed_apps — POST /{page-id}/subscribed_apps subscribed_fields=…,
 *     Page token, pages_manage_metadata + pages_show_list, answers { success }.
 *   - docs/platforminsights/page/deprecated-metrics + docs/graph-api/reference/insights — page_impressions*,
 *     page_fans, post_impressions* are GONE (15 Jun 2025 / 15 Nov 2025, every version). Replacements used here:
 *     page_follows, page_media_view, page_total_media_view_unique, page_post_engagements; per post
 *     post_media_view, post_total_media_view_unique, post_clicks, post_reactions_by_type_total.
 *   - docs/messenger-platform/conversations — GET /{page-id}/conversations?platform=messenger; messages via the
 *     conversation's `messages` field; details (from, to, message) for the 20 most recent messages only.
 *     Page token, MESSAGING or MODERATE task, pages_manage_metadata + pages_read_engagement + pages_messaging.
 *   - docs/messenger-platform/send-messages — POST /{page-id}/messages { recipient: { id: PSID },
 *     messaging_type: 'RESPONSE', message: { text } }, inside the 24-hour standard messaging window.
 * Not stated by any page read: that Page tokens from a long-lived user token never expire (Meta's
 * access-token guide says so; not re-read today), and the `message` parameter of /photos (used widely,
 * not in the page's example).
 */

export const META_FB_DEFAULT_APP_ID = '2142902776443404'
export const META_FB_DEFAULT_REDIRECT_URI = 'https://app.mdmmarketing.com.au/api/meta/facebook/callback'
export const META_FB_DEFAULT_CONFIG_ID = '1428692675563072'
export const META_FB_GRAPH = 'https://graph.facebook.com'
export const META_FB_GRAPH_VERSION = 'v23.0'
export const META_FB_DIALOG_URL = `https://www.facebook.com/${META_FB_GRAPH_VERSION}/dialog/oauth`

/** What the "Connect Facebook Page" configuration grants (set on Meta's side; not sent — config_id replaces scope). */
export const META_FB_PERMISSIONS = [
  'pages_show_list', 'pages_read_engagement', 'pages_read_user_content', 'pages_manage_posts',
  'pages_manage_engagement', 'pages_manage_metadata', 'read_insights',
  // added to the configuration 6 Nov 2026 (the owner: "need all") — Page Messenger, below
  'pages_messaging',
] as const

export const FB_STATE_TTL_MS = 10 * 60 * 1000

/* ── env (read lazily, every name spelled out — CLAUDE.md trap 7) ─────── */

export type MetaFbEnv = { appId: string; appSecret: string | null; redirectUri: string; configId: string }

export function readMetaFbEnv(): MetaFbEnv {
  return {
    appId: process.env.META_FB_APP_ID?.trim() || META_FB_DEFAULT_APP_ID,
    appSecret: process.env.META_APP_SECRET?.trim() || null,
    redirectUri: process.env.META_FB_REDIRECT_URI?.trim() || META_FB_DEFAULT_REDIRECT_URI,
    configId: process.env.META_FB_CONFIG_ID?.trim() || META_FB_DEFAULT_CONFIG_ID,
  }
}

export type FbReady = { ok: true; env: MetaFbEnv & { appSecret: string } } | { ok: false; reason: string }

/** Ready only with the app secret AND the key that encrypts the stored token. */
export function fbReadiness(env: MetaFbEnv, credentialsKeySet: boolean): FbReady {
  if (!env.appSecret) return { ok: false, reason: 'Facebook direct connection is not configured: META_APP_SECRET is not set.' }
  if (!credentialsKeySet) return { ok: false, reason: 'Facebook direct connection is not configured: CREDENTIALS_KEY is not set, so a token could not be stored encrypted.' }
  return { ok: true, env: { ...env, appSecret: env.appSecret } }
}

/* ── the signed `state` (the Instagram pattern, with its own prefix so neither state passes for the other) ── */

export type FbStatePayload = { clientId: string; userId: string; exp: number; n: string }
const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url')
const stateSig = (body: string, secret: string) => b64url(createHmac('sha256', secret).update(`fb-state.${body}`).digest())

export function signFbState(input: { clientId: string; userId: string; now: number; ttlMs?: number; nonce?: string }, secret: string): string {
  const payload: FbStatePayload = {
    clientId: input.clientId, userId: input.userId,
    exp: input.now + (input.ttlMs ?? FB_STATE_TTL_MS), n: input.nonce ?? randomBytes(8).toString('hex'),
  }
  const body = b64url(JSON.stringify(payload))
  return `${body}.${stateSig(body, secret)}`
}

export type FbStateCheck = { ok: true; payload: FbStatePayload } | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' }

export function verifyFbState(state: unknown, secret: string, now: number): FbStateCheck {
  if (typeof state !== 'string' || state.length > 2048) return { ok: false, reason: 'malformed' }
  const parts = state.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'malformed' }
  if (!safeEqual(parts[1], stateSig(parts[0], secret))) return { ok: false, reason: 'bad_signature' }
  let p: FbStatePayload
  try { p = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) } catch { return { ok: false, reason: 'malformed' } }
  if (!p || typeof p.clientId !== 'string' || !p.clientId || typeof p.userId !== 'string' || typeof p.exp !== 'number') {
    return { ok: false, reason: 'malformed' }
  }
  if (p.exp <= now) return { ok: false, reason: 'expired' }
  return { ok: true, payload: p }
}

/* ── URLs ─────────────────────────────────────────────────────────────── */

/** The Login for Business dialog. With config_id, no `scope` (the configuration carries the permissions). */
export function fbLoginUrl(p: { appId: string; redirectUri: string; configId: string; state: string }): string {
  const u = new URL(META_FB_DIALOG_URL)
  u.searchParams.set('client_id', p.appId)
  u.searchParams.set('redirect_uri', p.redirectUri)
  u.searchParams.set('config_id', p.configId)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('state', p.state)
  return u.toString()
}

export function fbGraphUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
  const u = new URL(`${META_FB_GRAPH}/${META_FB_GRAPH_VERSION}/${path.replace(/^\//, '')}`)
  for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined) u.searchParams.set(k, String(v))
  return u.toString()
}

/** code → short-lived user token (GET). */
export function fbCodeExchangeUrl(p: { appId: string; appSecret: string; redirectUri: string; code: string }): string {
  return fbGraphUrl('oauth/access_token', { client_id: p.appId, client_secret: p.appSecret, redirect_uri: p.redirectUri, code: p.code })
}

/** short-lived → long-lived user token (GET, grant_type=fb_exchange_token). */
export function fbLongLivedUrl(p: { appId: string; appSecret: string; shortToken: string }): string {
  return fbGraphUrl('oauth/access_token', { grant_type: 'fb_exchange_token', client_id: p.appId, client_secret: p.appSecret, fb_exchange_token: p.shortToken })
}

/** `appsecret_proof`: HMAC-SHA256 of the token with the app secret — sent on every call, so a leaked token alone is not enough when "Require App Secret" is on. */
export function appsecretProof(token: string, appSecret: string): string {
  return createHmac('sha256', appSecret).update(token, 'utf8').digest('hex')
}

const SECRET_PARAMS = ['access_token', 'client_secret', 'code', 'fb_exchange_token', 'appsecret_proof', 'input_token']

/** A URL with every token-shaped parameter replaced — for error messages. */
export function fbRedactUrl(url: string): string {
  try {
    const u = new URL(url)
    for (const k of SECRET_PARAMS) if (u.searchParams.has(k)) u.searchParams.set(k, 'REDACTED')
    return u.toString()
  } catch { return '(unparseable url)' }
}

/* ── what Meta answers ────────────────────────────────────────────────── */

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

export function fbErrorMessage(json: unknown, status?: number): string {
  const e = ((json ?? {}) as Record<string, any>).error
  if (e && typeof e === 'object') {
    const msg = typeof e.message === 'string' ? e.message : 'unknown error'
    const code = e.code != null ? ` (code ${e.code}${e.error_subcode != null ? `/${e.error_subcode}` : ''})` : ''
    // Meta sometimes echoes a token inside the message; never pass one on
    return `${msg}${code}`.replace(/EAA[A-Za-z0-9]{10,}/g, '[token]').slice(0, 300)
  }
  return status ? `HTTP ${status}` : 'unknown error'
}

export function fbErrorDetail(json: unknown): GraphErrorDetail {
  const e = ((json ?? {}) as Record<string, any>).error
  if (!e || typeof e !== 'object') return { code: null, subcode: null, transient: false, userMessage: null }
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null)
  const um = typeof e.error_user_msg === 'string' && e.error_user_msg.trim() ? e.error_user_msg.trim().slice(0, 300) : null
  return { code: num(e.code), subcode: num(e.error_subcode), transient: e.is_transient === true, userMessage: um }
}

export function parseUserToken(json: unknown): Parsed<{ accessToken: string; expiresIn: number | null }> {
  const j = (json ?? {}) as Record<string, any>
  if (typeof j.access_token !== 'string' || !j.access_token) return { ok: false, error: fbErrorMessage(json) }
  const exp = Number(j.expires_in)
  return { ok: true, value: { accessToken: j.access_token, expiresIn: Number.isFinite(exp) && exp > 0 ? exp : null } }
}

export const PAGE_LIST_FIELDS = 'id,name,access_token,category,picture,tasks'

export type FbPageGrant = { id: string; name: string | null; category: string | null; picture: string | null; tasks: string[]; accessToken: string }

/** `GET /me/accounts` → the Pages the person manages, each with its own Page token. Pages without a token are dropped. */
export function parsePages(json: unknown): FbPageGrant[] {
  const rows = Array.isArray((json as any)?.data) ? (json as any).data : []
  const out: FbPageGrant[] = []
  for (const r of rows) {
    if (!r || r.id == null || typeof r.access_token !== 'string' || !r.access_token) continue
    const pic = r.picture?.data?.url
    out.push({
      id: String(r.id),
      name: typeof r.name === 'string' ? r.name : null,
      category: typeof r.category === 'string' ? r.category : null,
      picture: typeof pic === 'string' ? pic : null,
      tasks: Array.isArray(r.tasks) ? r.tasks.map(String) : [],
      accessToken: r.access_token,
    })
  }
  return out
}

/** Does this person's role on the Page allow posting and moderating? */
export function canPublishWith(tasks: readonly string[]): boolean {
  return tasks.includes('CREATE_CONTENT') || tasks.includes('MANAGE')
}

export function isGraphId(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9]{3,40}(_[0-9]{3,40})?$/.test(v)
}

/* ── the candidate rule: which Pages the callback offers for a client ── */

export type PageRowLite = { id: string; client_id: string; active: boolean }

/**
 * For each Page the person granted: offer it to this client as a candidate, refresh the token of a Page
 * this client already has, or leave alone a Page that is ALREADY the picked Page of another client (it is
 * never moved from one client to another by a connect — a person disconnects it there first).
 */
export function candidatePlan(clientId: string, grants: readonly { id: string }[], existing: ReadonlyMap<string, PageRowLite>):
  { offer: string[]; keep: string[]; taken: string[] } {
  const offer: string[] = []; const keep: string[] = []; const taken: string[] = []
  for (const g of grants) {
    const cur = existing.get(g.id)
    if (cur && cur.active && cur.client_id !== clientId) taken.push(g.id)
    else if (cur && cur.active) keep.push(g.id)
    else offer.push(g.id)
  }
  return { offer, keep, taken }
}

/* ── publishing ───────────────────────────────────────────────────────── */

export type FbMedia = { type: 'image' | 'video' | 'document'; url: string }
export type FbPublishRequest =
  | { kind: 'TEXT'; message: string }
  | { kind: 'LINK'; message?: string; link: string }
  | { kind: 'PHOTO'; url: string; message?: string }
  | { kind: 'PHOTOS'; urls: string[]; message?: string }
  | { kind: 'VIDEO'; url: string; description?: string }

export const FB_MESSAGE_MAX = 63206
export const FB_PHOTOS_MAX = 10

export function validateFbPublish(r: FbPublishRequest): string | null {
  const text = r.kind === 'VIDEO' ? r.description : r.message
  if (text && text.length > FB_MESSAGE_MAX) return 'A Facebook post is at most 63,206 characters'
  if (r.kind === 'TEXT' && !r.message.trim()) return 'A Facebook post needs words, a picture or a video'
  if (r.kind === 'PHOTOS' && (r.urls.length < 2 || r.urls.length > FB_PHOTOS_MAX)) return `Several pictures means 2 to ${FB_PHOTOS_MAX}`
  if (r.kind === 'LINK' && !/^https?:\/\//i.test(r.link)) return 'A link must start with http:// or https://'
  return null
}

/** Endpoint + form parameters of the single publishing call (PHOTOS is built from fbUnpublishedPhotoParams + fbMultiPhotoParams). */
export function fbPublishCall(pageId: string, r: Exclude<FbPublishRequest, { kind: 'PHOTOS' }>): { path: string; params: Record<string, string> } {
  switch (r.kind) {
    case 'TEXT': return { path: `${pageId}/feed`, params: { message: r.message } }
    case 'LINK': return { path: `${pageId}/feed`, params: { link: r.link, ...(r.message ? { message: r.message } : {}) } }
    case 'PHOTO': return { path: `${pageId}/photos`, params: { url: r.url, ...(r.message ? { message: r.message } : {}) } }
    case 'VIDEO': return { path: `${pageId}/videos`, params: { file_url: r.url, ...(r.description ? { description: r.description } : {}) } }
  }
}

/** One picture of a several-picture post, uploaded unpublished first. */
export function fbUnpublishedPhotoParams(url: string): Record<string, string> {
  return { url, published: 'false' }
}

/** The post that carries the unpublished pictures: attached_media[i]={"media_fbid": id}. */
export function fbMultiPhotoParams(photoIds: readonly string[], message?: string): Record<string, string> {
  const out: Record<string, string> = {}
  photoIds.forEach((id, i) => { out[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id }) })
  if (message) out.message = message
  return out
}

/** Facebook's answer → the post id (`post_id` for a photo, `id` otherwise). */
export function publishedPostId(json: unknown): string | null {
  const j = (json ?? {}) as Record<string, unknown>
  const v = j.post_id ?? j.id
  return v == null || v === '' ? null : String(v)
}

/* ── the routing rule ─────────────────────────────────────────────────── */

export const META_FB_PROVIDER = 'meta_fb'

export type FbPageLite = { id: string; name: string | null; active: boolean }
export type FacebookRoute = { via: 'meta'; pageId: string; pageName: string | null } | { via: 'zernio'; reason: string | null }

type OptionsLike = { kind?: string; caption?: string; firstComment?: string; media?: { type: string; url: string }[] } & Record<string, unknown>

/**
 * A post's Facebook channel goes through our own Meta app only when ALL hold:
 *   1. `clients.facebook_via_meta` is on;
 *   2. the client has its ONE picked (active) meta_fb_pages row;
 *   3. it is a feed post (not a Story or a Reel — this road does not make those yet);
 *   4. its files are what this road sends: no documents, and either pictures only (1–10) or one video.
 * Otherwise Zernio, with the reason (null = not switched on, nothing to say).
 */
export function facebookRoute(input: { clientViaMeta: boolean | null | undefined; pages: readonly FbPageLite[]; media: readonly { type: string }[]; options?: OptionsLike | null }): FacebookRoute {
  if (input.clientViaMeta !== true) return { via: 'zernio', reason: null }
  const page = input.pages.find(p => p.active)
  if (!page) return { via: 'zernio', reason: 'No Facebook Page is connected directly (Meta) for this client, so this goes through Zernio' }
  const kind = input.options?.kind
  if (kind === 'story' || kind === 'reel') return { via: 'zernio', reason: `Facebook direct (Meta) does not make a ${kind === 'story' ? 'Story' : 'Reel'} yet, so this goes through Zernio` }
  const bad = fbMediaProblem(input.media)
  if (bad) return { via: 'zernio', reason: `${bad}, so this goes through Zernio` }
  return { via: 'meta', pageId: page.id, pageName: page.name }
}

export function fbMediaProblem(media: readonly { type: string }[]): string | null {
  if (media.some(m => m.type === 'document')) return 'Facebook direct (Meta) does not post documents'
  const videos = media.filter(m => m.type === 'video').length
  if (videos > 1 || (videos === 1 && media.length > 1)) return 'Facebook direct (Meta) posts one video on its own, or pictures only'
  if (media.length > FB_PHOTOS_MAX) return `Facebook direct (Meta) posts up to ${FB_PHOTOS_MAX} pictures`
  return null
}

/** One job's Facebook target → the request. The channel's own caption wins, as on Zernio. */
export function fbRequestFor(input: { caption: string; media: readonly FbMedia[]; options?: OptionsLike | null }):
  { ok: true; req: FbPublishRequest; firstComment: string | null } | { ok: false; reason: string } {
  const own = typeof input.options?.caption === 'string' && input.options.caption.trim() ? input.options.caption : null
  const text = (own ?? input.caption ?? '').trim()
  const bad = fbMediaProblem(input.media)
  if (bad) return { ok: false, reason: bad }
  const media = input.media.filter(m => m.type !== 'document')
  let req: FbPublishRequest
  if (media.length === 0) req = { kind: 'TEXT', message: text }
  else if (media[0].type === 'video') req = { kind: 'VIDEO', url: media[0].url, ...(text ? { description: text } : {}) }
  else if (media.length === 1) req = { kind: 'PHOTO', url: media[0].url, ...(text ? { message: text } : {}) }
  else req = { kind: 'PHOTOS', urls: media.map(m => m.url), ...(text ? { message: text } : {}) }
  const invalid = validateFbPublish(req)
  if (invalid) return { ok: false, reason: invalid }
  const first = typeof input.options?.firstComment === 'string' ? input.options.firstComment.trim() : ''
  return { ok: true, req, firstComment: first || null }
}

/* ── what a Facebook job remembers, so a retry never posts twice ──────── */

export type MetaFbJobState = {
  page_id: string
  page_name?: string | null
  /** written BEFORE the publishing call: set with no post_id means "it may have gone out" — never re-sent */
  sending_at?: string | null
  /** the unpublished pictures of a several-picture post, as they are uploaded (unpublished = invisible; safe to redo) */
  photo_ids?: string[]
  post_id?: string | null
  permalink?: string | null
  published_at?: string | null
  first_comment_id?: string | null
  first_comment_error?: string | null
}

export function readMetaFbJobState(v: unknown): MetaFbJobState | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (typeof o.page_id !== 'string' || !o.page_id) return null
  const s = (x: unknown) => (typeof x === 'string' && x ? x : null)
  return {
    page_id: o.page_id, page_name: s(o.page_name), sending_at: s(o.sending_at),
    photo_ids: Array.isArray(o.photo_ids) ? o.photo_ids.map(String) : [],
    post_id: s(o.post_id), permalink: s(o.permalink), published_at: s(o.published_at),
    first_comment_id: s(o.first_comment_id), first_comment_error: s(o.first_comment_error),
  }
}

/** What the publish step does with a job's record. */
export function fbResumeDecision(s: MetaFbJobState): 'done' | 'unknown' | 'send' {
  if (s.post_id) return 'done'
  if (s.sending_at) return 'unknown'
  return 'send'
}

const FB_TRANSIENT_CODES = [1, 2, 4, 17, 32, 341, 368, 613]

/** retry: worth another go; words: the sentence on the post. */
export function fbFailure(e: { message: string; status?: number; detail?: GraphErrorDetail | null }): { retry: boolean; words: string } {
  const d = e.detail ?? null
  const prefix = 'Facebook (direct, Meta): '
  const msg = String(e.message ?? '').trim() || 'unknown error'
  if (d?.code === 190) return { retry: false, words: `${prefix}the Page connection has expired or was removed — reconnect it with "Connect Facebook Page (Meta)" on the client's Social page` }
  if (d?.code === 10 || d?.code === 200) return { retry: false, words: `${prefix}Facebook refused permission — ${d.userMessage ?? msg}` }
  const retry = /^could not reach facebook/i.test(msg)
    || (typeof e.status === 'number' && (e.status >= 500 || e.status === 429))
    || d?.transient === true || (d?.code != null && FB_TRANSIENT_CODES.includes(d.code))
  return { retry: Boolean(retry), words: prefix + (d?.userMessage ?? msg) }
}

/* ── the inbox: posts, comments, numbers ──────────────────────────────── */

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const list = (v: unknown): any[] => (Array.isArray((v as any)?.data) ? (v as any).data : [])

export const FB_POST_FIELDS = 'id,message,created_time,permalink_url,full_picture,comments.summary(true).limit(0),reactions.summary(true).limit(0),shares'
export type FbPost = { id: string; message: string | null; at: string | null; permalink: string | null; picture: string | null; comments: number | null; reactions: number | null; shares: number | null }

export function parseFbPosts(json: unknown): FbPost[] {
  return list(json).filter(p => p && p.id != null).map(p => ({
    id: String(p.id), message: str(p.message), at: str(p.created_time), permalink: str(p.permalink_url), picture: str(p.full_picture),
    comments: num(p.comments?.summary?.total_count), reactions: num(p.reactions?.summary?.total_count), shares: num(p.shares?.count),
  }))
}

export const FB_COMMENT_FIELDS = 'id,message,created_time,from{id,name},is_hidden,can_hide,like_count,comments.limit(25){id,message,created_time,from{id,name},is_hidden,can_hide,like_count}'
export type FbComment = { id: string; text: string; name: string | null; at: string | null; hidden: boolean; canHide: boolean; likes: number | null; ours: boolean; replies: FbComment[] }

function oneFbComment(c: any, pageId: string): FbComment {
  const fromId = c?.from?.id != null ? String(c.from.id) : null
  return {
    id: String(c.id), text: str(c.message) ?? '', name: str(c?.from?.name), at: str(c.created_time),
    hidden: c.is_hidden === true, canHide: c.can_hide === true, likes: num(c.like_count), ours: fromId === pageId,
    replies: list(c.comments).filter(r => r && r.id != null).map(r => oneFbComment(r, pageId)).sort((a, b) => (a.at ?? '').localeCompare(b.at ?? '')),
  }
}

/** Newest first; replies oldest first. `from` is absent for people who have not granted the app — the name is then null. */
export function parseFbComments(json: unknown, pageId: string): FbComment[] {
  return list(json).filter(c => c && c.id != null).map(c => oneFbComment(c, pageId)).sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))
}

/** Page numbers (period=day, summed over the range — except followers, a running total: its latest value). */
export const PAGE_METRICS = ['page_follows', 'page_daily_follows_unique', 'page_media_view', 'page_total_media_view_unique', 'page_post_engagements', 'page_views_total'] as const
export const FB_POST_METRICS = ['post_media_view', 'post_total_media_view_unique', 'post_clicks', 'post_reactions_by_type_total'] as const
const LATEST_VALUE = new Set(['page_follows'])

export const FB_METRIC_WORDS: Record<string, string> = {
  page_follows: 'Followers',
  page_daily_follows_unique: 'New followers',
  page_media_view: 'Views',
  page_total_media_view_unique: 'People reached',
  page_post_engagements: 'Engagement',
  page_views_total: 'Page visits',
  post_media_view: 'Views',
  post_total_media_view_unique: 'People reached',
  post_clicks: 'Clicks',
  post_reactions_by_type_total: 'Reactions',
}

export type FbInsight = { metric: string; label: string; value: number | null }

const valueOf = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  // by-type metrics answer { like: 3, love: 1 }
  if (v && typeof v === 'object') {
    const n = Object.values(v as Record<string, unknown>).filter((x): x is number => typeof x === 'number' && Number.isFinite(x))
    return n.length ? n.reduce((a, b) => a + b, 0) : null
  }
  return null
}

export function parseFbInsights(json: unknown, order: readonly string[]): FbInsight[] {
  const by = new Map<string, number | null>()
  for (const row of list(json)) {
    const name = str(row?.name)
    if (!name || !Array.isArray(row?.values)) continue
    const nums = row.values.map((v: any) => valueOf(v?.value)).filter((n: number | null): n is number => n !== null)
    const value = nums.length === 0 ? null : LATEST_VALUE.has(name) ? nums[nums.length - 1] : nums.reduce((a: number, b: number) => a + b, 0)
    // the same metric can come back once per period; the first answer is kept
    if (!by.has(name)) by.set(name, value)
  }
  return order.filter(m => by.has(m)).map(m => ({ metric: m, label: FB_METRIC_WORDS[m] ?? m, value: by.get(m) ?? null }))
}

export function fbInsightRange(days: number, now: number): { since: number; until: number; days: number } {
  const d = days === 28 ? 28 : 7
  const until = Math.floor(now / 1000)
  return { since: until - d * 86400, until, days: d }
}

/* ── Messenger: the Page's conversations ──────────────────────────────── */

export const FB_CONVERSATION_FIELDS = 'id,updated_time,participants,messages.limit(20){id,created_time,from,to,message}'

export type FbMessage = { id: string; text: string; at: string | null; fromId: string | null; fromName: string | null; ours: boolean }
export type FbConversation = { id: string; updatedAt: string | null; personId: string | null; personName: string | null; messages: FbMessage[]; lastFromThemAt: string | null }

/** One conversation: messages oldest first; the person = the participant who is not the Page. */
export function parseFbConversation(c: any, pageId: string): FbConversation | null {
  if (!c || c.id == null) return null
  const messages: FbMessage[] = list(c.messages).filter(m => m && m.id != null).map(m => {
    const fromId = m.from?.id != null ? String(m.from.id) : null
    return { id: String(m.id), text: str(m.message) ?? '', at: str(m.created_time), fromId, fromName: str(m.from?.name), ours: fromId === pageId }
  }).sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''))
  const other = list(c.participants).find(p => p && p.id != null && String(p.id) !== pageId)
  const theirs = [...messages].reverse().find(m => !m.ours && m.fromId)
  return {
    id: String(c.id), updatedAt: str(c.updated_time),
    personId: other ? String(other.id) : theirs?.fromId ?? null,
    personName: (other ? str(other.name) : null) ?? theirs?.fromName ?? null,
    messages, lastFromThemAt: theirs?.at ?? null,
  }
}

export function parseFbConversations(json: unknown, pageId: string): FbConversation[] {
  return list(json).map(c => parseFbConversation(c, pageId)).filter((c): c is FbConversation => !!c)
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
}

export const MESSENGER_WINDOW_MS = 24 * 60 * 60 * 1000

/** The standard messaging window: the Page may answer for 24 hours after the person's last message. */
export function messengerWindowOpen(lastFromThemAt: string | null, now: number): boolean {
  if (!lastFromThemAt) return false
  const t = Date.parse(lastFromThemAt)
  return Number.isFinite(t) && now - t < MESSENGER_WINDOW_MS
}

/** The body of POST /{page-id}/messages — a reply inside the window (RESPONSE). No message tags are ever sent. */
export function fbMessageBody(psid: string, text: string): Record<string, unknown> {
  return { recipient: { id: psid }, messaging_type: 'RESPONSE', message: { text } }
}

export const FB_MESSAGE_TEXT_MAX = 2000

/* ── what a person may ask the inbox to do ────────────────────────────── */

export const FB_INBOX_ACTIONS = ['reply', 'hide', 'unhide', 'delete', 'message'] as const
export type FbInboxRequest =
  | { action: 'reply'; commentId: string; text: string }
  | { action: 'hide' | 'unhide' | 'delete'; commentId: string }
  | { action: 'message'; recipientId: string; text: string }
export const FB_COMMENT_MAX = 8000

export function readFbInboxRequest(body: unknown): { ok: true; value: FbInboxRequest } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>
  const action = b.action as FbInboxRequest['action']
  if (!(FB_INBOX_ACTIONS as readonly string[]).includes(action)) return { ok: false, error: 'Unknown action' }
  if (action === 'message') {
    const recipientId = typeof b.recipientId === 'string' ? b.recipientId.trim() : ''
    if (!/^[0-9]{3,40}$/.test(recipientId)) return { ok: false, error: 'Choose a conversation to write in' }
    const text = typeof b.text === 'string' ? b.text.trim() : ''
    if (!text) return { ok: false, error: 'Write a message first' }
    if (text.length > FB_MESSAGE_TEXT_MAX) return { ok: false, error: `A message is at most ${FB_MESSAGE_TEXT_MAX} characters` }
    return { ok: true, value: { action, recipientId, text } }
  }
  const commentId = typeof b.commentId === 'string' ? b.commentId.trim() : ''
  if (!isGraphId(commentId)) return { ok: false, error: 'Choose a comment first' }
  if (action === 'reply') {
    const text = typeof b.text === 'string' ? b.text.trim() : ''
    if (!text) return { ok: false, error: 'Write a reply first' }
    if (text.length > FB_COMMENT_MAX) return { ok: false, error: `That is over ${FB_COMMENT_MAX} characters` }
    return { ok: true, value: { action, commentId, text } }
  }
  return { ok: true, value: { action, commentId } }
}

export const FB_INBOX_VIEWS = ['posts', 'comments', 'insights', 'messages'] as const
export type FbInboxView = typeof FB_INBOX_VIEWS[number]

/* ── the Page webhook ─────────────────────────────────────────────────── */

/** The Page fields this app subscribes to: the feed (posts, comments) and Messenger messages. */
export const PAGE_WEBHOOK_FIELDS = ['feed', 'messages'] as const

export type PageEvent = { key: string; pageId: string; kind: 'feed' | 'messages'; item: string | null; payload: unknown; occurredAt: string | null }

export function pageEventKey(pageId: string, payload: unknown, kind: 'feed' | 'messages' = 'feed'): string {
  return `${kind}_${createHash('sha256').update(`${kind}|${pageId}|${JSON.stringify(payload)}`).digest('hex').slice(0, 32)}`
}

/**
 * `{ object: 'page', entry: [{ id, time, changes: [{ field: 'feed', value }], messaging: [{ sender, recipient,
 * timestamp, message }] }] }` → the feed changes and the Messenger events. Anything else is [].
 */
export function parsePageWebhookEvents(body: unknown): PageEvent[] {
  const b = (body ?? {}) as Record<string, any>
  if (b.object !== 'page' || !Array.isArray(b.entry)) return []
  const out: PageEvent[] = []
  for (const entry of b.entry) {
    if (!entry || entry.id == null) continue
    const pageId = String(entry.id)
    const t = Number(entry.time)
    const at = Number.isFinite(t) && t > 0 ? new Date(t < 1e12 ? t * 1000 : t).toISOString() : null
    for (const ch of Array.isArray(entry.changes) ? entry.changes : []) {
      if (ch?.field !== 'feed') continue
      const payload = ch.value ?? null
      out.push({ key: pageEventKey(pageId, payload), pageId, kind: 'feed', item: str((payload as any)?.item), payload, occurredAt: at })
    }
    for (const m of Array.isArray(entry.messaging) ? entry.messaging : []) {
      if (!m) continue
      const ts = Number(m.timestamp)
      const item = m.message ? 'message' : m.read ? 'read' : m.delivery ? 'delivery' : m.postback ? 'postback' : m.reaction ? 'reaction' : null
      out.push({ key: pageEventKey(pageId, m, 'messages'), pageId, kind: 'messages', item, payload: m,
        occurredAt: Number.isFinite(ts) && ts > 0 ? new Date(ts < 1e12 ? ts * 1000 : ts).toISOString() : at })
    }
  }
  return out
}
