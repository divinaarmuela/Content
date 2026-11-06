import {
  FB_COMMENT_FIELDS, FB_CONVERSATION_FIELDS, FB_POST_FIELDS, fbMessageBody, PAGE_LIST_FIELDS, PAGE_WEBHOOK_FIELDS,
  appsecretProof, fbCodeExchangeUrl, fbErrorDetail, fbErrorMessage, fbGraphUrl, fbLongLivedUrl, fbMultiPhotoParams,
  fbPublishCall, fbRedactUrl, fbUnpublishedPhotoParams, parsePages, parseUserToken, publishedPostId,
  type FbPageGrant, type FbPublishRequest,
} from './meta-fb-core'
import type { GraphErrorDetail } from './meta-ig-core'

/**
 * FACEBOOK PAGES API — the Graph calls, portable (6 Nov 2026). Imports nothing of MD Media's (no database,
 * no auth), like meta-ig-client.ts. Every call takes the token as an argument; the app secret rides along
 * only as `appsecret_proof`. Errors are built from Meta's text or a redacted URL, never a URL with a token.
 */

export class MetaFbError extends Error {
  public detail: GraphErrorDetail | null
  constructor(message: string, public status?: number, detail?: GraphErrorDetail | null) {
    super(message); this.name = 'MetaFbError'; this.detail = detail ?? null
  }
}

async function call(url: string, init?: RequestInit): Promise<any> {
  let res: Response
  try {
    res = await fetch(url, { ...init, cache: 'no-store' })
  } catch {
    throw new MetaFbError(`Could not reach Facebook (${fbRedactUrl(url).split('?')[0]})`)
  }
  const json = await res.json().catch(() => null)
  if (!res.ok || (json && typeof json === 'object' && 'error' in json && json.error)) {
    throw new MetaFbError(fbErrorMessage(json, res.status), res.status, fbErrorDetail(json))
  }
  return json
}

/** A Page (or user) token plus the app secret, for appsecret_proof. */
export type FbAuth = { token: string; appSecret: string }

const signed = (url: string, a: FbAuth) => {
  const u = new URL(url)
  u.searchParams.set('access_token', a.token)
  u.searchParams.set('appsecret_proof', appsecretProof(a.token, a.appSecret))
  return u.toString()
}
const get = (a: FbAuth, path: string, params?: Record<string, string | number | boolean | undefined>) => call(signed(fbGraphUrl(path, params), a))
const post = (a: FbAuth, path: string, params: Record<string, string>) => call(signed(fbGraphUrl(path), a), {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString(),
})
const del = (a: FbAuth, path: string) => call(signed(fbGraphUrl(path), a), { method: 'DELETE' })

/* ── the login ────────────────────────────────────────────────────────── */

export type FbAppConfig = { appId: string; appSecret: string; redirectUri: string }

/** code → short-lived user token → long-lived user token → the Pages, each with its Page token. */
export async function completeFbLogin(cfg: FbAppConfig, code: string): Promise<{ pages: FbPageGrant[] }> {
  const short = parseUserToken(await call(fbCodeExchangeUrl({ ...cfg, code })))
  if (!short.ok) throw new MetaFbError(short.error)
  const long = parseUserToken(await call(fbLongLivedUrl({ appId: cfg.appId, appSecret: cfg.appSecret, shortToken: short.value.accessToken })))
  if (!long.ok) throw new MetaFbError(long.error)
  // Page tokens read with a LONG-LIVED user token do not expire (Meta's access-token guide)
  const pages = parsePages(await get({ token: long.value.accessToken, appSecret: cfg.appSecret }, 'me/accounts', { fields: PAGE_LIST_FIELDS, limit: 100 }))
  return { pages }
}

/* ── publishing ───────────────────────────────────────────────────────── */

/** One unpublished picture of a several-picture post — invisible until attached. */
export async function uploadUnpublishedPhoto(a: FbAuth, pageId: string, url: string): Promise<string> {
  return String((await post(a, `${pageId}/photos`, fbUnpublishedPhotoParams(url))).id)
}

/** THE one call that makes a post. A caller that must never post twice records that it is about to call this. */
export async function publishOnce(a: FbAuth, pageId: string, req: FbPublishRequest, photoIds: string[] = []): Promise<{ postId: string }> {
  const json = req.kind === 'PHOTOS'
    ? await post(a, `${pageId}/feed`, fbMultiPhotoParams(photoIds, req.message))
    : await (async () => { const c = fbPublishCall(pageId, req); return post(a, c.path, c.params) })()
  const id = publishedPostId(json)
  if (!id) throw new MetaFbError('Facebook did not say which post it made')
  return { postId: id }
}

export async function postPermalink(a: FbAuth, postId: string): Promise<string | null> {
  const j = await get(a, postId, { fields: 'permalink_url' })
  return typeof j?.permalink_url === 'string' ? j.permalink_url : null
}

/* ── reading and moderating ───────────────────────────────────────────── */

export async function listPagePosts(a: FbAuth, pageId: string, limit = 12): Promise<unknown> {
  return get(a, `${pageId}/posts`, { fields: FB_POST_FIELDS, limit })
}
export async function listPostComments(a: FbAuth, postId: string): Promise<unknown> {
  return get(a, `${postId}/comments`, { fields: FB_COMMENT_FIELDS, filter: 'toplevel', order: 'reverse_chronological', limit: 50 })
}
export async function replyToFbComment(a: FbAuth, objectId: string, message: string): Promise<{ id: string }> {
  return { id: String((await post(a, `${objectId}/comments`, { message })).id) }
}
export async function hideFbComment(a: FbAuth, commentId: string, hide: boolean): Promise<{ ok: boolean }> {
  const j = await post(a, commentId, { is_hidden: hide ? 'true' : 'false' })
  return { ok: j?.success !== false }
}
export async function deleteFbComment(a: FbAuth, commentId: string): Promise<{ ok: boolean }> {
  const j = await del(a, commentId)
  return { ok: j?.success !== false }
}

/* ── numbers ──────────────────────────────────────────────────────────── */

export async function pageInsights(a: FbAuth, pageId: string, q: { metrics: readonly string[]; since: number; until: number }): Promise<unknown> {
  return get(a, `${pageId}/insights`, { metric: q.metrics.join(','), period: 'day', since: q.since, until: q.until })
}
export async function postInsights(a: FbAuth, postId: string, metrics: readonly string[]): Promise<unknown> {
  return get(a, `${postId}/insights`, { metric: metrics.join(','), period: 'lifetime' })
}
export async function pageProfile(a: FbAuth, pageId: string): Promise<{ name: string | null; followers: number | null; link: string | null }> {
  const j = await get(a, pageId, { fields: 'name,followers_count,link' })
  return {
    name: typeof j?.name === 'string' ? j.name : null,
    followers: typeof j?.followers_count === 'number' ? j.followers_count : null,
    link: typeof j?.link === 'string' ? j.link : null,
  }
}

/* ── Messenger ────────────────────────────────────────────────────────── */

export async function listPageConversations(a: FbAuth, pageId: string, limit = 15): Promise<unknown> {
  return get(a, `${pageId}/conversations`, { platform: 'messenger', fields: FB_CONVERSATION_FIELDS, limit })
}
/** One message's details — Meta answers for the 20 most recent messages of a conversation only. */
export async function pageMessageDetail(a: FbAuth, messageId: string): Promise<unknown> {
  return get(a, messageId, { fields: 'id,created_time,from,to,message' })
}
/** A reply inside the 24-hour window (messaging_type RESPONSE). */
export async function sendPageMessage(a: FbAuth, pageId: string, psid: string, text: string): Promise<{ messageId: string | null }> {
  const j = await call(signed(fbGraphUrl(`${pageId}/messages`), a), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fbMessageBody(psid, text)),
  })
  return { messageId: j?.message_id ? String(j.message_id) : null }
}

/* ── webhooks ─────────────────────────────────────────────────────────── */

/** `POST /{page-id}/subscribed_apps` with the Page token (pages_manage_metadata). */
export async function subscribePage(a: FbAuth, pageId: string, fields: readonly string[] = PAGE_WEBHOOK_FIELDS): Promise<{ success: boolean }> {
  const j = await post(a, `${pageId}/subscribed_apps`, { subscribed_fields: fields.join(',') })
  return { success: j?.success === true }
}
