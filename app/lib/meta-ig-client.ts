import {
  META_IG_TOKEN_URL, carouselItemParams, carouselParentParams, codeExchangeBody, containerParams,
  containerState, graphErrorDetail, graphErrorMessage, graphUrl, longLivedTokenUrl, messageBody, parseLongToken, parseMe,
  parseShortToken, publishingRoom, redactUrl, refreshTokenUrl, validatePublish,
  type GraphErrorDetail, type IgMe, type LongToken, type PublishItem, type PublishRequest, type ShortToken,
} from './meta-ig-core'

/**
 * INSTAGRAM API WITH INSTAGRAM LOGIN — the Graph calls, PORTABLE (1 Oct 2026).
 *
 * This file and meta-ig-core.ts are the part meant to be lifted into another
 * codebase unchanged (the owner: the same integration may be reused in
 * "unlk.ai"). They import nothing of MD Media's — no database, no auth, no
 * workflow, no UI, not even `server-only` — only node:crypto and the global
 * fetch. Configuration is passed in (or read once by readMetaIgEnv in the
 * core); every call takes the access token as an argument and stores nothing.
 * The MD Media wiring — tables, encryption, routes, the refresh job, the UI —
 * lives in meta-ig.ts and the routes, and is what a second product rewrites.
 *
 * Tokens ride in the `access_token` query parameter, as Meta's Instagram docs
 * show. They are never logged, and every error message is built from Meta's
 * error text or a redacted URL, never from a URL carrying a token.
 */

export type MetaIgAppConfig = { appId: string; appSecret: string; redirectUri: string }

export class MetaIgError extends Error {
  /** Meta's code / subcode / is_transient / error_user_msg, when Meta answered with an error envelope */
  public detail: GraphErrorDetail | null
  constructor(message: string, public status?: number, detail?: GraphErrorDetail | null) {
    super(message); this.name = 'MetaIgError'; this.detail = detail ?? null
  }
}

async function call(url: string, init?: RequestInit): Promise<any> {
  let res: Response
  try {
    res = await fetch(url, { ...init, cache: 'no-store' })
  } catch {
    throw new MetaIgError(`Could not reach Instagram (${redactUrl(url).split('?')[0]})`)
  }
  const json = await res.json().catch(() => null)
  if (!res.ok || (json && typeof json === 'object' && 'error' in json && json.error)) {
    throw new MetaIgError(graphErrorMessage(json, res.status), res.status, graphErrorDetail(json))
  }
  return json
}

const withToken = (url: string, token: string) => {
  const u = new URL(url); u.searchParams.set('access_token', token); return u.toString()
}
const get = (token: string, path: string, params?: Record<string, string | number | boolean | undefined>) =>
  call(withToken(graphUrl(path, params), token))
const post = (token: string, path: string, params: Record<string, string>) =>
  call(withToken(graphUrl(path), token), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  })
const postJson = (token: string, path: string, body: unknown) =>
  call(withToken(graphUrl(path), token), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

/* ── the login ────────────────────────────────────────────────────────── */

export async function exchangeCode(cfg: MetaIgAppConfig, code: string): Promise<ShortToken> {
  const json = await call(META_IG_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: codeExchangeBody({ appId: cfg.appId, appSecret: cfg.appSecret, redirectUri: cfg.redirectUri, code }).toString(),
  })
  const parsed = parseShortToken(json)
  if (!parsed.ok) throw new MetaIgError(parsed.error)
  return parsed.value
}

export async function toLongLived(cfg: Pick<MetaIgAppConfig, 'appSecret'>, shortToken: string): Promise<LongToken> {
  const parsed = parseLongToken(await call(longLivedTokenUrl({ appSecret: cfg.appSecret, shortToken })))
  if (!parsed.ok) throw new MetaIgError(parsed.error)
  return parsed.value
}

/** Meta refuses a token under 24 hours old, and an expired one. */
export async function refreshLongLived(token: string): Promise<LongToken> {
  const parsed = parseLongToken(await call(refreshTokenUrl(token)))
  if (!parsed.ok) throw new MetaIgError(parsed.error)
  return parsed.value
}

export async function getMe(token: string): Promise<IgMe> {
  const parsed = parseMe(await get(token, 'me', { fields: 'user_id,username,account_type' }))
  if (!parsed.ok) throw new MetaIgError(parsed.error)
  return parsed.value
}

/** Code → short-lived → long-lived → /me, in one go. */
export async function completeLogin(cfg: MetaIgAppConfig, code: string): Promise<{ short: ShortToken; long: LongToken; me: IgMe }> {
  const short = await exchangeCode(cfg, code)
  const long = await toLongLived(cfg, short.accessToken)
  const me = await getMe(long.accessToken)
  return { short, long, me }
}

/* ── publishing ───────────────────────────────────────────────────────── */

/** Room left in the 24-hour publishing quota, or null if Instagram did not say. */
export async function publishingLimit(token: string, igUserId: string): Promise<{ used: number; total: number } | null> {
  return publishingRoom(await get(token, `${igUserId}/content_publishing_limit`, { fields: 'quota_usage,config' }))
}

/** A container's `status_code` (IN_PROGRESS, FINISHED, PUBLISHED, ERROR, EXPIRED), as Meta wrote it. */
export async function containerStatus(token: string, id: string): Promise<string | null> {
  const json = await get(token, id, { fields: 'status_code' })
  return typeof json?.status_code === 'string' ? json.status_code : null
}

/** Poll a container until it is FINISHED (or PUBLISHED). ERROR/EXPIRED throw; running out of tries throws a "still processing". */
export async function waitForContainer(token: string, id: string, opts: { tries: number; delayMs: number }): Promise<void> {
  for (let i = 0; i < opts.tries; i++) {
    const code = await containerStatus(token, id)
    const s = containerState(code)
    if (s === 'ready') return
    if (s === 'failed') throw new MetaIgError(`Instagram could not process the media (${String(code)})`)
    if (opts.delayMs > 0) await new Promise(r => setTimeout(r, opts.delayMs))
  }
  throw new MetaIgError('Instagram is still processing the media — try publishing again shortly')
}

/** One `POST /{ig-user-id}/media` for a carousel item. Returns the child container id. */
export async function createCarouselItem(token: string, igUserId: string, item: PublishItem): Promise<string> {
  return String((await post(token, `${igUserId}/media`, carouselItemParams(item))).id)
}

/** The container a post is published from: the carousel parent from its children, or the single container. */
export async function createContainer(token: string, igUserId: string, req: PublishRequest, childIds: string[] = []): Promise<string> {
  const params = req.kind === 'CAROUSEL' ? carouselParentParams(childIds, req.caption) : containerParams(req)
  return String((await post(token, `${igUserId}/media`, params)).id)
}

/** `POST /{ig-user-id}/media_publish` — the one call that makes a post. Instagram publishes a container once. */
export async function publishContainer(token: string, igUserId: string, creationId: string): Promise<{ mediaId: string }> {
  const published = await post(token, `${igUserId}/media_publish`, { creation_id: creationId })
  return { mediaId: String(published.id) }
}

/** The public link of a published media, or null if Instagram did not give one. */
export async function mediaPermalink(token: string, mediaId: string): Promise<string | null> {
  const json = await get(token, mediaId, { fields: 'permalink' })
  return typeof json?.permalink === 'string' && json.permalink ? json.permalink : null
}

/** A comment on a media, written by the account itself — how a post's "first comment" is made. */
export async function commentOnMedia(token: string, mediaId: string, message: string): Promise<{ id: string }> {
  return { id: String((await post(token, `${mediaId}/comments`, { message })).id) }
}

/** Does this request make a video container that has to be waited on? */
export function isVideoRequest(req: PublishRequest): boolean {
  return req.kind === 'REELS' || req.kind === 'CAROUSEL' || (req.kind === 'STORIES' && req.media.type === 'video')
}

/**
 * Container → media_publish, for IMAGE, REELS, STORIES and CAROUSEL. The
 * publishing quota is read first, and a full quota refuses before anything
 * is created. Video containers are polled until FINISHED.
 *
 * Stateless: a caller that must never publish twice (MD Media's publish jobs,
 * meta-ig-publish.ts) uses the pieces above instead, and records the
 * container id before media_publish.
 */
export async function publish(
  token: string,
  igUserId: string,
  req: PublishRequest,
  opts: { tries?: number; delayMs?: number } = {},
): Promise<{ mediaId: string }> {
  const invalid = validatePublish(req)
  if (invalid) throw new MetaIgError(invalid)
  const wait = { tries: opts.tries ?? 30, delayMs: opts.delayMs ?? 5000 }

  const room = await publishingLimit(token, igUserId)
  if (room && room.used >= room.total) {
    throw new MetaIgError(`Instagram's publishing limit is reached (${room.used} of ${room.total} in 24 hours)`)
  }

  const children: string[] = []
  if (req.kind === 'CAROUSEL') {
    for (const item of req.items) {
      const child = await createCarouselItem(token, igUserId, item)
      if (item.type === 'video') await waitForContainer(token, child, wait)
      children.push(child)
    }
  }
  const creationId = await createContainer(token, igUserId, req, children)
  if (isVideoRequest(req)) await waitForContainer(token, creationId, wait)
  return publishContainer(token, igUserId, creationId)
}

/* ── comments ─────────────────────────────────────────────────────────── */

export type IgComment = { id: string; text?: string; username?: string; timestamp?: string; hidden?: boolean; like_count?: number }

export async function listComments(token: string, mediaId: string): Promise<IgComment[]> {
  const json = await get(token, `${mediaId}/comments`, { fields: 'id,text,username,timestamp,hidden,like_count' })
  return Array.isArray(json?.data) ? json.data : []
}

export async function replyToComment(token: string, commentId: string, message: string): Promise<{ id: string }> {
  return { id: String((await post(token, `${commentId}/replies`, { message })).id) }
}

export async function hideComment(token: string, commentId: string, hide: boolean): Promise<{ ok: boolean }> {
  const json = await post(token, commentId, { hide: hide ? 'true' : 'false' })
  return { ok: json?.success !== false }
}

/* ── messages ─────────────────────────────────────────────────────────── */

/** A private reply: one DM to the person who wrote a comment. */
export async function privateReply(token: string, commentId: string, text: string): Promise<{ messageId: string | null }> {
  const json = await postJson(token, 'me/messages', messageBody({ commentId }, text))
  return { messageId: json?.message_id ? String(json.message_id) : null }
}

/**
 * A DM inside the 24-hour window. The HUMAN_AGENT tag (a person answering, up
 * to 7 days) is added only when the caller asks AND `allowHumanAgent` (the
 * host's switch) is true.
 */
export async function sendMessage(
  token: string, recipientId: string, text: string,
  opts: { humanAgent?: boolean; allowHumanAgent?: boolean } = {},
): Promise<{ messageId: string | null }> {
  const humanAgent = Boolean(opts.humanAgent && opts.allowHumanAgent)
  const json = await postJson(token, 'me/messages', messageBody({ userId: recipientId }, text, { humanAgent }))
  return { messageId: json?.message_id ? String(json.message_id) : null }
}

/* ── insights ─────────────────────────────────────────────────────────── */

export async function accountInsights(
  token: string, igUserId: string,
  q: { metrics: string[]; period?: string; metricType?: string; since?: number; until?: number },
): Promise<unknown> {
  return get(token, `${igUserId}/insights`, {
    metric: q.metrics.join(','), period: q.period ?? 'day', metric_type: q.metricType, since: q.since, until: q.until,
  })
}

export async function mediaInsights(token: string, mediaId: string, metrics: string[]): Promise<unknown> {
  return get(token, `${mediaId}/insights`, { metric: metrics.join(',') })
}

/** The webhook fields an Instagram account sends this app (comments, messages and the rest of the messaging events). */
export const WEBHOOK_FIELDS = ['comments', 'messages', 'message_reactions', 'messaging_postbacks', 'messaging_seen', 'messaging_referral'] as const

/**
 * TELL INSTAGRAM TO SEND THIS ACCOUNT'S EVENTS TO THE APP (1 Oct 2026: the webhook was saved and verified, but
 * no account was subscribed, so nothing would ever arrive). One call per connected account, with its own token.
 */
export async function subscribeAccount(token: string, fields: readonly string[] = WEBHOOK_FIELDS): Promise<{ success: boolean }> {
  const out = await post(token, 'me/subscribed_apps', { subscribed_fields: fields.join(',') }) as { success?: unknown }
  return { success: out?.success === true }
}
