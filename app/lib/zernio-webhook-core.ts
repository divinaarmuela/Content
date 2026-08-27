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

/**
 * What we ask the provider to send us when registering the webhook.
 *
 * The whole list, not the handful the post events needed. Every one of these
 * is something a screen in this dashboard otherwise learns by polling, and an
 * event we are not subscribed to is not a quiet degradation — it is a screen
 * that silently keeps its old latency. Anything here we do not act on yet is
 * logged and acknowledged (see `parseZernioEvent`), which costs one row in
 * `webhook_deliveries` and tells the next person the event really does arrive.
 *
 * Names are Zernio's own, verified against their OpenAPI document
 * (`docs.zernio.com/api/openapi`, the `events` enum on
 * POST/PUT /v1/webhooks/settings) rather than transcribed from a page.
 */
export const ZERNIO_WEBHOOK_EVENTS = [
  // publishing lifecycle
  'post.scheduled',
  'post.published',
  'post.failed',
  'post.partial',
  'post.cancelled',
  'post.recycled',
  // per-platform results — the incremental half of the same story
  'post.platform.published',
  'post.platform.failed',
  'post.platform.deleted',
  'post.tiktok.url_resolved',
  // posts made natively on the platform, detected by their background sync
  'post.external.created',
  'post.external.updated',
  'post.external.deleted',
  // accounts
  'account.connected',
  'account.disconnected',
  'account.ads.initial_sync_completed',
  // inbox
  'message.received',
  'message.sent',
  'message.edited',
  'message.deleted',
  'message.delivered',
  'message.read',
  'message.failed',
  'reaction.received',
  'referral.received',
  'conversation.started',
  'comment.received',
  // engagement worth a human being told about
  'review.new',
  'review.updated',
  'lead.received',
  'ad.status_changed',
] as const

export type ZernioAction =
  /** the post-level rollup: every platform succeeded */
  | { kind: 'published'; postId: string; permalink: string | null; platforms: string[] }
  /** the post-level rollup: failed, or published to only some platforms */
  | { kind: 'failed'; postId: string; error: string }
  /** one platform inside a post finished — or a TikTok URL arrived late */
  | {
      kind: 'platform_published'
      postId: string
      platform: string
      permalink: string | null
      platformPostId: string | null
      accountId: string | null
      /** true for post.tiktok.url_resolved: a back-fill, never a state change */
      backfillOnly: boolean
    }
  /** one platform inside a post failed permanently */
  | { kind: 'platform_failed'; postId: string; platform: string; error: string }
  /** the publishing job was cancelled before anything went out */
  | { kind: 'cancelled'; postId: string }
  /** the provider has accepted and is holding the post */
  | { kind: 'scheduled'; postId: string; scheduledFor: string | null }
  | { kind: 'account_inactive'; accountId: string }
  /** a client connected an account: their channel list is now out of date */
  | { kind: 'account_connected'; accountId: string; profileId: string | null; platform: string | null }
  /** a new comment on one of our posts */
  | {
      kind: 'comment'
      commentId: string
      accountId: string | null
      platform: string | null
      platformPostId: string | null
      text: string
    }
  /** anything that changes what the Inbox page would show */
  | {
      kind: 'inbox'
      accountId: string | null
      conversationId: string | null
      platform: string | null
      /** the event's own name, so the log line says which of the family it was */
      detail: string
    }
  /** a review landed — somebody's account manager should hear about it */
  | {
      kind: 'review'
      reviewId: string
      accountId: string | null
      platform: string | null
      rating: number | null
      text: string
      updated: boolean
    }
  /** a Lead Gen form submission */
  | {
      kind: 'lead'
      leadId: string
      accountId: string | null
      formName: string | null
      /** the submitted fields, already flattened to strings */
      fields: Record<string, string>
    }
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

/**
 * The live URL a platform assigned, from whichever shape carries it.
 *
 * The webhook payloads call this `publishedUrl` (verified in the OpenAPI
 * document: `post.platforms[].publishedUrl`, `platform.publishedUrl`); the
 * REST analytics shapes this codebase already reads call it `platformPostUrl`.
 * Both are accepted, because the cost of guessing wrong is a webhook that
 * verifies, returns 200 and quietly delivers no link.
 */
function urlOf(row: Record<string, unknown>): string {
  return str(row.publishedUrl) || str(row.platformPostUrl)
}

function permalinkOf(post: Record<string, unknown>, data: Record<string, unknown>): string | null {
  const direct = urlOf(data) || urlOf(post)
  if (direct) return direct
  const lists = [post.platforms, post.platformAnalytics, data.platforms, data.platform]
  for (const list of lists) {
    const rows = Array.isArray(list) ? list : [list]
    for (const row of rows) {
      const url = urlOf(asRecord(row))
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

  // ── per-platform results ───────────────────────────────────────────────
  //
  // These arrive BEFORE the rollup and one per platform, which is the whole
  // reason to want them: a post to three channels shows its first live link
  // as soon as that channel finishes, instead of when the slowest one does.
  // `post.tiktok.url_resolved` reuses the same payload — TikTok hands over its
  // public URL minutes after it reports the post published, so that event is a
  // URL back-fill and must never be read as a state change.
  if (event === 'post.platform.published' || event === 'post.tiktok.url_resolved'
    || event === 'post.platform.failed') {
    const postId = postIdOf(post, data)
    if (!postId) return ignore('no post id')
    const block = asRecord(data.platform ?? root.platform)
    const account = accountRecord(root, data)
    const platform = (str(block.name) || str(block.platform) || str(account.platform)).toLowerCase()

    if (event === 'post.platform.failed') {
      const message = str(block.error) || str(block.errorMessage)
      return {
        eventId,
        event,
        action: {
          kind: 'platform_failed',
          postId,
          platform,
          error: message
            || `${platform || 'The platform'} refused the post and did not say why`,
        },
      }
    }
    return {
      eventId,
      event,
      action: {
        kind: 'platform_published',
        postId,
        platform,
        permalink: urlOf(block) || permalinkOf(post, data) || null,
        platformPostId: str(block.platformPostId) || null,
        accountId: accountIdOf(account) || null,
        backfillOnly: event === 'post.tiktok.url_resolved',
      },
    }
  }

  // Cancelled before anything went out. (If one platform HAD already
  // published, the provider sends post.partial instead — so this genuinely
  // means nothing is live, and the item is still waiting to be scheduled.)
  if (event === 'post.cancelled') {
    const postId = postIdOf(post, data)
    if (!postId) return ignore('no post id')
    return { eventId, event, action: { kind: 'cancelled', postId } }
  }

  // "Accepted and queued", not "scheduled for later" — it also fires for a
  // publish-now. Confirmation only: our row already says this, and saying it
  // again must move nothing.
  if (event === 'post.scheduled') {
    const postId = postIdOf(post, data)
    if (!postId) return ignore('no post id')
    return {
      eventId,
      event,
      action: { kind: 'scheduled', postId, scheduledFor: str(post.scheduledFor) || null },
    }
  }

  // account.disconnected / .revoked / .expired — already in production since
  // 20 Aug, kept here so one handler serves the whole webhook
  if (event.startsWith('account.')
    && (event.includes('disconnect') || event.includes('revoked') || event.includes('expired'))) {
    const account = accountRecord(root, data)
    const accountId = accountIdOf(account)
    if (!accountId) return ignore('no account id')
    return { eventId, event, action: { kind: 'account_inactive', accountId } }
  }

  // The client has just finished an OAuth flow. Their channel list is stale by
  // exactly one account, and the posting card is still saying "no account
  // connected" about something that now works.
  if (event === 'account.connected') {
    const account = accountRecord(root, data)
    const accountId = accountIdOf(account)
    if (!accountId) return ignore('no account id')
    return {
      eventId,
      event,
      action: {
        kind: 'account_connected',
        accountId,
        profileId: str(account.profileId) || str(account.profile_id) || null,
        platform: str(account.platform).toLowerCase() || null,
      },
    }
  }

  if (event === 'comment.received') {
    const comment = asRecord(data.comment ?? root.comment)
    const commentId = str(comment.id) || str(comment._id)
    if (!commentId) return ignore('no comment id')
    const account = accountRecord(root, data)
    return {
      eventId,
      event,
      action: {
        kind: 'comment',
        commentId,
        accountId: accountIdOf(account) || null,
        platform: (str(comment.platform) || str(account.platform)).toLowerCase() || null,
        platformPostId: str(comment.platformPostId) || null,
        text: str(comment.text).slice(0, 500),
      },
    }
  }

  if (event === 'review.new' || event === 'review.updated') {
    const review = asRecord(data.review ?? root.review)
    const reviewId = str(review.id) || str(review._id)
    if (!reviewId) return ignore('no review id')
    const account = accountRecord(root, data)
    const rating = typeof review.rating === 'number' ? review.rating : null
    return {
      eventId,
      event,
      action: {
        kind: 'review',
        reviewId,
        accountId: accountIdOf(account) || null,
        platform: (str(review.platform) || str(account.platform)).toLowerCase() || null,
        rating,
        text: str(review.text).slice(0, 1000),
        updated: event === 'review.updated',
      },
    }
  }

  if (event === 'lead.received') {
    const lead = asRecord(data.lead ?? root.lead)
    const leadId = str(lead.id) || str(lead.leadgenId) || str(lead._id)
    if (!leadId) return ignore('no lead id')
    const fields: Record<string, string> = {}
    for (const [k, v] of Object.entries(asRecord(lead.fields))) {
      const value = str(v)
      if (value) fields[String(k).slice(0, 60)] = value.slice(0, 300)
    }
    return {
      eventId,
      event,
      action: {
        kind: 'lead',
        leadId,
        accountId: accountIdOf(accountRecord(root, data)) || null,
        formName: str(lead.formName) || null,
        fields,
      },
    }
  }

  // Everything that changes what the Inbox page would render. They are one
  // action rather than six because the Inbox reads its conversations LIVE from
  // the provider — there is no local message store to write a message into, so
  // the only thing any of these can do is tell an open Inbox that its view is
  // now behind.
  if (INBOX_EVENTS.has(event)) {
    const conversation = asRecord(data.conversation ?? root.conversation)
    const message = asRecord(data.message ?? root.message)
    const account = accountRecord(root, data)
    return {
      eventId,
      event,
      action: {
        kind: 'inbox',
        accountId: accountIdOf(account) || null,
        conversationId: str(conversation.id) || str(message.conversationId) || null,
        platform: (str(conversation.platform) || str(message.platform) || str(account.platform))
          .toLowerCase() || null,
        detail: event,
      },
    }
  }

  return ignore(event ? `unhandled event ${event}` : 'no event name')
}

/** Inbox-family events: any of these means "the Inbox is out of date". */
const INBOX_EVENTS = new Set([
  'message.received',
  'message.sent',
  'message.edited',
  'message.deleted',
  'message.delivered',
  'message.read',
  'message.failed',
  'reaction.received',
  'referral.received',
  'conversation.started',
])

/**
 * The `account` block, wherever this event family happens to hang it, with
 * `accountId` from an envelope-less delivery carried alongside.
 *
 * The envelope-less fallback is `root.accountId` by name and NOT `root` as a
 * whole: on every real payload `root.id` is the webhook EVENT id, and a
 * generic id-hunt over the root would happily mistake one for the other and
 * deactivate an account that is perfectly fine.
 */
function accountRecord(
  root: Record<string, unknown>, data: Record<string, unknown>,
): Record<string, unknown> {
  const block = asRecord(data.account ?? root.account ?? data)
  return str(root.accountId) ? { accountId: str(root.accountId), ...block } : block
}

/**
 * The connected account's id, as `social_accounts.provider_account_id` stores it.
 *
 * `accountId` first: the inbox and comment payloads carry BOTH `id` and
 * `accountId` on their account block, and only `accountId` is documented as
 * the value `/v1/accounts/{accountId}` takes — which is the one we joined on.
 */
function accountIdOf(account: Record<string, unknown>): string {
  return str(account.accountId) || str(account.account_id)
    || str(account._id) || str(account.id)
}
