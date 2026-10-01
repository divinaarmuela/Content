import 'server-only'
import { DbError, table } from '@/lib/db'
import type { MetaIgAccount, MetaIgEvent } from '@/lib/db-types'
import { credentialsKeyConfigured, decryptSecret, encryptSecret } from './secret-box'
import {
  deliveryIdOf, expiresAtFrom, parseWebhookEvents, readMetaIgEnv, selectForRefresh,
  type MetaIgEnv, type PublishRequest,
} from './meta-ig-core'
import * as ig from './meta-ig-client'

/**
 * THE AGENCY'S OWN INSTAGRAM CONNECTION — MD Media's wiring (1 Oct 2026).
 *
 * The portable part is meta-ig-core.ts (pure) and meta-ig-client.ts (the
 * Graph calls). THIS file is what ties them to MD Media: the
 * `meta_ig_accounts` / `meta_ig_events` tables, token encryption, the refresh
 * job's body, the webhook's record-keeping, and token lookup by account.
 *
 * INERT until configured: every entry point asks metaIgReady() first, and the
 * routes answer 503 with the reason. NOT wired into scheduling or publishing:
 * Zernio (publisher.ts, comment-automation*, zernio-webhook*) still does all
 * of that. Nothing here replies to anyone on its own — the send wrappers
 * exist for a person to call later, and nothing calls them yet.
 *
 * Tokens: stored as AES-GCM ciphertext (secret-box, CREDENTIALS_KEY), never
 * logged, never returned to a browser.
 */

export { MetaIgError } from './meta-ig-client'

export type Ready = { ok: true; env: MetaIgEnv & { appSecret: string } } | { ok: false; reason: string }

export function metaIgReady(): Ready {
  const env = readMetaIgEnv()
  if (!env.appSecret) return { ok: false, reason: 'Instagram direct connection is not configured: META_IG_APP_SECRET is not set.' }
  if (!credentialsKeyConfigured()) return { ok: false, reason: 'Instagram direct connection is not configured: CREDENTIALS_KEY is not set, so a token could not be stored encrypted.' }
  return { ok: true, env: { ...env, appSecret: env.appSecret } }
}

/** What a browser may see of a row: everything but the token. */
export type PublicIgAccount = Omit<MetaIgAccount, 'access_token_encrypted'>
export function publicRow(r: MetaIgAccount): PublicIgAccount {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { access_token_encrypted, ...rest } = r
  return rest
}

/**
 * Code → short-lived → long-lived → /me → one row, keyed by the Instagram id.
 *
 * Connecting the same account again (a reconnect, or a second person) is the
 * same row: the claim replaces the token and the client it is for, and keeps
 * when it was first connected.
 */
export async function connectAccount(
  ready: Ready & { ok: true },
  input: { code: string; clientId: string; userId: string; now: number },
): Promise<PublicIgAccount> {
  const { short, long, me } = await ig.completeLogin(ready.env, input.code)
  const nowIso = new Date(input.now).toISOString()
  const encrypted = encryptSecret(long.accessToken)
  const result = await table<MetaIgAccount>('meta_ig_accounts').claim(me.userId, current => ({
    id: me.userId,
    client_id: input.clientId,
    username: me.username,
    account_type: me.accountType,
    access_token_encrypted: encrypted,
    token_expires_at: expiresAtFrom(input.now, long.expiresIn),
    scopes: short.permissions,
    connected_by: input.userId,
    connected_at: current?.connected_at ?? nowIso,
    refreshed_at: nowIso,
    status: 'active',
    last_error: null,
  }))
  if (!result.claimed) throw new ig.MetaIgError('Could not save the connection — please try again')
  return publicRow(result.row)
}

export async function listClientAccounts(clientId: string): Promise<PublicIgAccount[]> {
  const rows = await table<MetaIgAccount>('meta_ig_accounts').list({ by: { client_id: clientId }, fresh: true })
  return rows.map(publicRow).sort((a, b) => (a.username ?? '').localeCompare(b.username ?? ''))
}

/** The decrypted token of an ACTIVE account. Server-side only. */
export async function accessTokenFor(igUserId: string): Promise<string> {
  const row = await table<MetaIgAccount>('meta_ig_accounts').get(igUserId, { fresh: true })
  if (!row) throw new ig.MetaIgError('That Instagram account is not connected directly')
  if (row.status !== 'active') throw new ig.MetaIgError(`That Instagram account's connection is ${row.status} — reconnect it`)
  return decryptSecret(row.access_token_encrypted)
}

/* ── the daily refresh ────────────────────────────────────────────────── */

export type RefreshSummary = { skipped?: string; refreshed: number; expired: number; failed: number }

export async function refreshDueTokens(now: number): Promise<RefreshSummary> {
  const ready = metaIgReady()
  if (!ready.ok) return { skipped: ready.reason, refreshed: 0, expired: 0, failed: 0 }
  const t = table<MetaIgAccount>('meta_ig_accounts')
  const rows = await t.list({ fresh: true })
  const { refresh, expire } = selectForRefresh(rows, now)
  const summary: RefreshSummary = { refreshed: 0, expired: 0, failed: 0 }

  // only the row the job chose is moved: a reconnect that landed in between
  // (new token) is not overwritten by stale news
  const settle = (seen: MetaIgAccount, patch: Partial<MetaIgAccount>) =>
    t.claim(seen.id, cur => (cur && cur.status === 'active'
      && cur.access_token_encrypted === seen.access_token_encrypted) ? { ...cur, ...patch } : null)

  for (const r of expire) {
    const res = await settle(r, { status: 'expired', last_error: 'The token passed its expiry before it could be refreshed' })
    if (res.claimed) summary.expired++
  }
  for (const r of refresh) {
    try {
      const fresh = await ig.refreshLongLived(decryptSecret(r.access_token_encrypted))
      const res = await settle(r, {
        access_token_encrypted: encryptSecret(fresh.accessToken),
        token_expires_at: expiresAtFrom(now, fresh.expiresIn) ?? r.token_expires_at,
        refreshed_at: new Date(now).toISOString(),
        last_error: null,
      })
      if (res.claimed) summary.refreshed++
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'refresh failed'
      const res = await settle(r, { status: 'expired', last_error: msg.slice(0, 300) })
      if (res.claimed) summary.failed++
    }
  }
  return summary
}

/* ── webhooks: record, never act ──────────────────────────────────────── */

export type WebhookRecord =
  | { kind: 'duplicate' }
  | { kind: 'recorded'; stored: number; deliveryId: string }

/**
 * Record one verified delivery. The delivery log (`webhook_deliveries`,
 * provider 'meta_ig', keyed by a hash of the raw body) is the same unique
 * claim the Zernio webhook uses, so a redelivery is a duplicate. Each
 * comment / mention / message is then claimed in `meta_ig_events` under a key
 * derived from the event, so the same event inside a different batch is still
 * one row. Nothing is sent, replied to or emailed.
 */
export async function recordWebhook(rawBody: string, body: unknown, now: number): Promise<WebhookRecord> {
  const hash = deliveryIdOf(rawBody)
  const receivedAt = new Date(now).toISOString()
  const events = parseWebhookEvents(body)
  let deliveryRowId: string
  try {
    const row = await table('webhook_deliveries').insert({
      provider: 'meta_ig',
      event: String((body as { object?: unknown } | null)?.object ?? 'unknown'),
      provider_event_id: hash,
      // the same `${provider}__${eventId}` shape as zernio-events.ts providerEventKey
      // (not imported: that module pulls in the mailer, and this one must not)
      provider_event_key: `meta_ig__${hash}`,
      received_at: receivedAt,
      handled: false,
      note: null,
    })
    deliveryRowId = row.id
  } catch (e) {
    if (e instanceof DbError && e.code === 'unique') return { kind: 'duplicate' }
    throw e
  }

  try {
    const owners = new Map<string, string | null>()
    let stored = 0
    for (const ev of events) {
      if (!owners.has(ev.igUserId)) {
        const acct = await table<MetaIgAccount>('meta_ig_accounts').get(ev.igUserId)
        owners.set(ev.igUserId, acct?.client_id ?? null)
      }
      const res = await table<MetaIgEvent>('meta_ig_events').claim(ev.key, cur => cur ? null : {
        id: ev.key,
        ig_user_id: ev.igUserId,
        client_id: owners.get(ev.igUserId) ?? null,
        kind: ev.kind,
        payload: ev.payload,
        occurred_at: ev.occurredAt,
        received_at: receivedAt,
        delivery_id: deliveryRowId,
      })
      if (res.claimed) stored++
    }
    await table('webhook_deliveries').update(deliveryRowId, {
      handled: stored > 0,
      note: events.length ? `stored ${stored} of ${events.length} event(s)` : 'nothing stored (field not kept)',
    }).catch(() => undefined)
    return { kind: 'recorded', stored, deliveryId: deliveryRowId }
  } catch (e) {
    // give the claim back so Meta's redelivery is not mistaken for a duplicate
    await table('webhook_deliveries').remove(deliveryRowId).catch(() => undefined)
    throw e
  }
}

/* ── by account: the client calls with the stored token (NOT wired anywhere yet) ── */

export async function publishFor(igUserId: string, req: PublishRequest, opts: { tries?: number; delayMs?: number } = {}) {
  return ig.publish(await accessTokenFor(igUserId), igUserId, req, opts)
}
export async function listCommentsFor(igUserId: string, mediaId: string) {
  return ig.listComments(await accessTokenFor(igUserId), mediaId)
}
export async function replyToCommentFor(igUserId: string, commentId: string, message: string) {
  return ig.replyToComment(await accessTokenFor(igUserId), commentId, message)
}
export async function hideCommentFor(igUserId: string, commentId: string, hide: boolean) {
  return ig.hideComment(await accessTokenFor(igUserId), commentId, hide)
}
export async function privateReplyFor(igUserId: string, commentId: string, text: string) {
  return ig.privateReply(await accessTokenFor(igUserId), commentId, text)
}
/** HUMAN_AGENT only when asked AND META_IG_HUMAN_AGENT=1. */
export async function sendMessageFor(igUserId: string, recipientId: string, text: string, opts: { humanAgent?: boolean } = {}) {
  return ig.sendMessage(await accessTokenFor(igUserId), recipientId, text, {
    humanAgent: opts.humanAgent, allowHumanAgent: process.env.META_IG_HUMAN_AGENT === '1',
  })
}
export async function accountInsightsFor(igUserId: string, q: Parameters<typeof ig.accountInsights>[2]) {
  return ig.accountInsights(await accessTokenFor(igUserId), igUserId, q)
}
export async function mediaInsightsFor(igUserId: string, mediaId: string, metrics: string[]) {
  return ig.mediaInsights(await accessTokenFor(igUserId), mediaId, metrics)
}
