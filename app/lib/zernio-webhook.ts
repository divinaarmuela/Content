import 'server-only'
import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { decryptSecret } from './secret-box'
import { authorizeDelivery, parseZernioEvent } from './zernio-webhook-core'

/**
 * One handler for every Zernio webhook delivery.
 *
 * The provider is told about ONE url; both routes that expose this
 * (`/api/social/webhook`, kept because that is what is registered today, and
 * `/api/zernio/webhook`) call straight into here, so there is a single
 * implementation of "what a delivery means" no matter which path it lands on.
 *
 * Why this exists at all: `reconcilePublishedJobs` polls every 10 minutes, so
 * a post could be live on Instagram for nine minutes while the board still
 * said "Scheduled" and the scheduler had no link to send the client. The
 * provider knows the instant it happens.
 *
 * Idempotency is not a cache and not an event-id table — it is the conditional
 * UPDATE. A delivery only does work if it moves a job OUT of a non-terminal
 * status; the second, third and seventh delivery of the same event update zero
 * rows and therefore transition nothing. That is the same "claim, don't
 * check-then-write" pattern the publish queue uses.
 */

/**
 * The URL Zernio should deliver to.
 *
 * `/api/social/webhook` and not the newer `/api/zernio/webhook`, because that
 * is the path already registered in production — changing it would mean a
 * window where the old registration is gone and the new one has not been saved
 * yet. Both paths run the same handler, so the choice is only about not
 * disturbing a working registration.
 */
export function zernioWebhookUrl(): string {
  const host = process.env.NEXT_PUBLIC_APP_HOST?.trim().toLowerCase() || 'app.mdmmarketing.com.au'
  return `https://${host}/api/social/webhook`
}

/** Statuses a webhook may move a job out of. A settled job is left alone. */
const OPEN_STATUSES = ['queued', 'publishing', 'scheduled']

/** Platform names off a job's stored targets — the fallback for crediting. */
function platformsOfTargets(targets: unknown): string[] {
  if (!Array.isArray(targets)) return []
  return [...new Set(targets
    .map(t => String((t as { platform?: unknown })?.platform ?? '').toLowerCase())
    .filter(Boolean))]
}

/**
 * Every secret a delivery may be signed with.
 *
 * Both the env var and any secret minted by "Enable instant post updates" are
 * accepted, so registering through the UI cannot silently orphan deliveries
 * that were already arriving against `ZERNIO_WEBHOOK_SECRET`.
 *
 * Cached briefly: this runs on every delivery, and the answer changes only
 * when somebody presses a button.
 */
let cache: { at: number; secrets: string[] } | null = null

export async function webhookSecrets(): Promise<string[]> {
  if (cache && Date.now() - cache.at < 60_000) return cache.secrets

  const secrets: string[] = []
  const env = process.env.ZERNIO_WEBHOOK_SECRET
  if (env) secrets.push(env)

  try {
    const { data } = await supabase
      .from('provider_webhooks')
      .select('secret_encrypted')
      .eq('provider', 'zernio')
      .eq('active', true)
    for (const row of data ?? []) {
      const packed = row.secret_encrypted as string | null
      if (!packed) continue
      // a secret we cannot decrypt (CREDENTIALS_KEY rotated) must not take the
      // whole endpoint down with it — the other secrets still work
      try { secrets.push(decryptSecret(packed)) } catch { /* skip */ }
    }
  } catch {
    // the table may not exist yet; the env var alone is a complete setup
  }

  const unique = [...new Set(secrets.filter(Boolean))]
  cache = { at: Date.now(), secrets: unique }
  return unique
}

/** Drop the cached secrets after registering a new one. */
export function forgetWebhookSecrets(): void {
  cache = null
}

export async function handleZernioWebhook(req: Request): Promise<Response> {
  // the signature is over the RAW body, so it must be read as text and parsed
  // by us — req.json() would discard the exact bytes that were signed
  const rawBody = await req.text()
  const url = new URL(req.url)

  const auth = authorizeDelivery({
    rawBody,
    signature: req.headers.get('x-zernio-signature'),
    token:
      req.headers.get('x-webhook-secret')
      ?? req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
      ?? url.searchParams.get('token')
      ?? url.searchParams.get('secret'),
    secrets: await webhookSecrets(),
  })

  if (auth === 'unconfigured') {
    return NextResponse.json({ error: 'Webhooks are not configured' }, { status: 503 })
  }
  if (auth === 'unauthorized') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { event, eventId, action } = parseZernioEvent(body)

  switch (action.kind) {
    case 'published':  return published(action.postId, action.permalink, action.platforms)
    case 'failed':     return failed(action.postId, action.error)
    case 'account_inactive': return accountInactive(action.accountId)
    case 'ignore':
      // 200, never 4xx: an unrecognised payload answered with an error is
      // redelivered for ~51 hours and still unrecognised every time
      console.warn('zernio webhook ignored:', event, eventId, action.reason)
      return NextResponse.json({ ok: true, ignored: action.reason })
  }
}

/** The post is live. Settle the job, then walk the item scheduled → published. */
async function published(
  postId: string, permalink: string | null, platforms: string[],
): Promise<Response> {
  const now = new Date().toISOString()
  const { data: rows, error } = await supabase
    .from('publish_jobs')
    .update({
      status: 'published',
      published_at: now,
      updated_at: now,
      error: null,
      ...(permalink ? { permalink } : {}),
    })
    .eq('provider_post_id', postId)
    .in('status', OPEN_STATUSES)   // ← the claim; zero rows means already done
    .select('id, content_item_id, targets')

  if (error) {
    // a real database failure SHOULD be retried by the provider
    console.error('zernio webhook could not settle the job:', postId, error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!rows?.length) {
    // Either a repeat delivery or a job `runPublishJob` already settled
    // synchronously. Both are no-ops — except that the platform assigns the
    // permalink after the fact, so a link we did not have before is still
    // worth keeping. Writing it only where it is null keeps that idempotent.
    if (permalink) {
      await supabase.from('publish_jobs')
        .update({ permalink })
        .eq('provider_post_id', postId)
        .is('permalink', null)
    }
    return NextResponse.json({ ok: true, duplicate: true })
  }

  const job = rows[0]
  if (job.content_item_id) {
    // production-publish owns writing this back into the board: the same
    // system actor, the same workflow_activity row, the same notifications as
    // every other transition. Imported lazily so this module does not pull the
    // workflow machine into every request that merely verifies a signature.
    const { recordPublishOnItem } = await import('./production-publish')
    await recordPublishOnItem(
      job.content_item_id as string,
      permalink,
      platforms.length ? platforms : platformsOfTargets(job.targets),
    )
  }
  return NextResponse.json({ ok: true, published: job.id })
}

/**
 * The provider could not post it.
 *
 * The job is marked failed and the content item is deliberately left where it
 * is — still "Scheduled", which is true: it is booked and it did not go out.
 * Moving it backwards would erase the scheduler's work over a failure that is
 * usually a re-auth away from being retried.
 */
async function failed(postId: string, message: string): Promise<Response> {
  const { data: rows, error } = await supabase
    .from('publish_jobs')
    .update({ status: 'failed', error: message, updated_at: new Date().toISOString() })
    .eq('provider_post_id', postId)
    .in('status', OPEN_STATUSES)
    .select('id')

  if (error) {
    console.error('zernio webhook could not record the failure:', postId, error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!rows?.length) return NextResponse.json({ ok: true, duplicate: true })
  return NextResponse.json({ ok: true, failed: rows[0].id })
}

/**
 * An account was revoked or expired at the platform.
 *
 * Shipped 20 Aug and unchanged: without it a dead account is only discovered
 * when a post fails, which is after somebody has noticed nothing went out.
 */
async function accountInactive(accountId: string): Promise<Response> {
  const { error } = await supabase
    .from('social_accounts')
    .update({ active: false })
    .eq('provider_account_id', accountId)
  if (error) {
    console.error('zernio webhook account update failed:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, marked: accountId })
}
