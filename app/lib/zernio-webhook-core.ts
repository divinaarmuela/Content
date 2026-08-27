import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Zernio webhooks — authentication and payload → action, as pure functions.
 *
 * The dashboard used to learn a post was live from a 10-minute reconcile poll,
 * so "it's out" arrived up to ten minutes after it was true. The provider will
 * tell us the moment it happens; this module is the part of receiving that
 * which can be decided without touching the database, so it can be tested
 * exhaustively rather than reasoned about.
 *
 * Two rules run through everything here:
 *
 *   1. The payload is a STRANGER. Only the post id, the event name, the
 *      permalink and the platform names are ever read out of it — never a
 *      content item id, never a client, never a status to write verbatim.
 *      Everything else is looked up locally from the post id.
 *   2. Deliveries repeat. Zernio is explicitly at-least-once (up to 7
 *      attempts over ~51 hours), so every action must be safe to apply twice.
 *      That guarantee lives in the caller's conditional UPDATE; this module
 *      just refuses to make an unknown event look like a known one.
 *
 * Docs: https://docs.zernio.com/webhooks (envelope, signature, retries),
 *       https://docs.zernio.com/webhooks/posts (post events).
 */

/** Events we act on. Anything else is logged and acknowledged. */
export const ZERNIO_POST_EVENTS = ['post.published', 'post.failed', 'post.partial'] as const

/** What we ask the provider to send us when registering the webhook. */
export const ZERNIO_WEBHOOK_EVENTS = [
  'post.published',
  'post.failed',
  'post.partial',
  'account.disconnected',
] as const

export type ZernioAction =
  | { kind: 'published'; postId: string; permalink: string | null; platforms: string[] }
  | { kind: 'failed'; postId: string; error: string }
  | { kind: 'account_inactive'; accountId: string }
  | { kind: 'ignore'; reason: string }

export type ZernioEvent = {
  /** the provider's stable event id — `payload.id` / `X-Zernio-Event-Id` */
  eventId: string | null
  event: string
  action: ZernioAction
}

/* ── signature ────────────────────────────────────────────────────────── */

/** Lowercase hex HMAC-SHA256 of the raw body, keyed by the webhook secret. */
export function signZernioBody(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
}

/** Constant-time compare that cannot throw on a length mismatch. */
function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  // timingSafeEqual throws unless the lengths match, and the throw itself
  // leaks the length — so compare lengths first and still run the compare.
  if (x.length !== y.length) return false
  return timingSafeEqual(x, y)
}

/**
 * Does `signature` verify against any of our known secrets?
 *
 * More than one secret is accepted so the env-var secret and a secret minted
 * by "Enable instant post updates" can both be live — otherwise registering
 * would silently break the deliveries already arriving.
 */
export function verifyZernioSignature(
  rawBody: string, signature: string | null | undefined, secrets: string[],
): boolean {
  if (!signature) return false
  // some senders prefix the algorithm; Zernio does not, but accepting it
  // costs nothing and a rejected-but-genuine delivery is retried for 51 hours
  const provided = signature.trim().replace(/^sha256=/i, '').toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(provided)) return false
  return secrets.some(s => s && sameSecret(provided, signZernioBody(rawBody, s)))
}

export type DeliveryAuth = 'ok' | 'unauthorized' | 'unconfigured'

/**
 * May this delivery mutate anything?
 *
 * A signature is the real check. A bare shared secret in a header or query
 * string is the fallback, because the account.disconnected webhook shipped on
 * 20 Aug was registered that way and flipping to signatures must not drop it.
 *
 * With no secret configured at all the answer is `unconfigured`, never `ok`:
 * an open endpoint that marks posts published would be worse than no webhook.
 */
export function authorizeDelivery(input: {
  rawBody: string
  signature?: string | null
  token?: string | null
  secrets: string[]
}): DeliveryAuth {
  const secrets = input.secrets.filter(Boolean)
  if (secrets.length === 0) return 'unconfigured'
  if (input.signature) {
    return verifyZernioSignature(input.rawBody, input.signature, secrets) ? 'ok' : 'unauthorized'
  }
  const token = input.token
  if (!token) return 'unauthorized'
  return secrets.some(s => sameSecret(s, token)) ? 'ok' : 'unauthorized'
}

/* ── payload → action ─────────────────────────────────────────────────── */

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''
}

/**
 * The provider's own post id.
 *
 * `publish_jobs.provider_post_id` is written from the create response's `_id`;
 * the webhook guide calls the same value `id`. Both are accepted, plus the
 * `postId` spelling used by the per-platform events, because getting this
 * wrong means a webhook that verifies, returns 200 and does nothing.
 */
function postIdOf(post: Record<string, unknown>, data: Record<string, unknown>): string {
  return str(post._id) || str(post.id) || str(data.postId) || str(data.post_id)
}

/** The live URL the platform assigned, from whichever shape carries it. */
function permalinkOf(post: Record<string, unknown>, data: Record<string, unknown>): string | null {
  const direct = str(data.platformPostUrl) || str(post.platformPostUrl)
  if (direct) return direct
  const lists = [post.platforms, post.platformAnalytics, data.platforms, data.platform]
  for (const list of lists) {
    const rows = Array.isArray(list) ? list : [list]
    for (const row of rows) {
      const url = str(asRecord(row).platformPostUrl)
      if (url) return url
    }
  }
  return null
}

/** Platform names, used only to credit the audit trail ("Posted by Instagram"). */
function platformsOf(post: Record<string, unknown>, data: Record<string, unknown>): string[] {
  const out: string[] = []
  for (const list of [post.platforms, data.platforms, data.platform]) {
    const rows = Array.isArray(list) ? list : [list]
    for (const row of rows) {
      const r = asRecord(row)
      const name = str(r.platform) || str(r.name)
      if (name) out.push(name.toLowerCase())
    }
  }
  return [...new Set(out)]
}

/** The provider's reason for a failure, or a usable stand-in. */
function errorOf(post: Record<string, unknown>, data: Record<string, unknown>, event: string): string {
  const rows: Record<string, unknown>[] = []
  for (const list of [post.platforms, data.platforms]) {
    if (Array.isArray(list)) for (const row of list) rows.push(asRecord(row))
  }
  const messages = [...new Set(rows
    .filter(r => str(r.status) === 'failed')
    .map(r => str(r.errorMessage) || str(r.error))
    .filter(Boolean))]
  const detail = messages.join('; ')
    || str(data.errorMessage) || str(data.error) || str(post.errorMessage) || str(post.error)

  if (event === 'post.partial') {
    return detail
      ? `The provider published to some platforms only: ${detail}`
      : 'The provider published to some platforms only'
  }
  return detail || 'The provider reported the post as failed'
}

/**
 * Turn one delivery into the single thing we will do about it.
 *
 * Unknown events, and known events without a post id, become `ignore` — a 200
 * with nothing done. Answering 4xx would only make the provider redeliver the
 * same unusable payload for two days.
 */
export function parseZernioEvent(body: unknown): ZernioEvent {
  const root = asRecord(body)
  const event = (str(root.event) || str(root.type)).toLowerCase()
  const eventId = str(root.id) || str(root.eventId) || null

  const data = asRecord(root.data)
  // envelope-less deliveries (and the account webhook already in production)
  // put the fields at the top level
  const post = asRecord(data.post ?? root.post ?? (event.startsWith('post.') ? root : {}))

  const ignore = (reason: string): ZernioEvent =>
    ({ eventId, event, action: { kind: 'ignore', reason } })

  if (event === 'post.published') {
    const postId = postIdOf(post, data)
    if (!postId) return ignore('no post id')
    return {
      eventId,
      event,
      action: {
        kind: 'published',
        postId,
        permalink: permalinkOf(post, data),
        platforms: platformsOf(post, data),
      },
    }
  }

  if (event === 'post.failed' || event === 'post.partial') {
    const postId = postIdOf(post, data)
    if (!postId) return ignore('no post id')
    return { eventId, event, action: { kind: 'failed', postId, error: errorOf(post, data, event) } }
  }

  // account.disconnected / .revoked / .expired — already in production since
  // 20 Aug, kept here so one handler serves the whole webhook
  if (event.startsWith('account.')
    && (event.includes('disconnect') || event.includes('revoked') || event.includes('expired'))) {
    const account = asRecord(data.account ?? root.account ?? data)
    const accountId = str(account.accountId) || str(account.account_id)
      || str(account._id) || str(account.id) || str(root.accountId)
    if (!accountId) return ignore('no account id')
    return { eventId, event, action: { kind: 'account_inactive', accountId } }
  }

  return ignore(event ? `unhandled event ${event}` : 'no event name')
}
