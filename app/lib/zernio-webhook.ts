import 'server-only'
import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { decryptSecret } from './secret-box'
import { authorizeDelivery, parseZernioEvent } from './zernio-webhook-core'
import {
  claimDelivery, finishDelivery, releaseDelivery,
  platformPublished, platformFailed, postCancelled, postScheduledConfirmed,
  accountConnected, reviewReceived, leadReceived,
} from './zernio-events'

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

  // ── the idempotency claim ────────────────────────────────────────────
  // Zernio is at-least-once (7 attempts over ~51 hours), so a repeat is
  // routine rather than exceptional. The unique index on the event id decides
  // who does the work; every handler below is ALSO idempotent on its own, so
  // an unmigrated log table degrades to yesterday's behaviour rather than to
  // double-writes.
  const claim = await claimDelivery(event || 'unknown', eventId)
  if (claim.kind === 'duplicate') {
    return NextResponse.json({ ok: true, duplicate: true })
  }

  const done = async (res: Response, handled: boolean, note?: string) => {
    // A delivery we are about to refuse must NOT keep its claim: the provider
    // redelivers it, the claim would make that redelivery look like a duplicate,
    // and a transient database failure would become a permanent one.
    if (!res.ok) await releaseDelivery(claim)
    else await finishDelivery(claim, handled, note)
    return res
  }

  switch (action.kind) {
    case 'published': {
      const res = await published(action.postId, action.permalink, action.platforms)
      // The platform's own numbers are not available the instant it publishes —
      // Meta and TikTok both need a few minutes before insights return anything
      // but zeroes. Ten minutes later is early enough that a client opening the
      // portal after a morning post sees real figures, and late enough that the
      // figures are real.
      if (res.ok) await scheduleFirstAnalyticsFetch(action.postId)
      return done(res, res.ok, action.permalink ? 'permalink captured' : undefined)
    }
    case 'failed':
      return done(await failed(action.postId, action.error), true, action.error)

    case 'platform_published': {
      const wrote = await platformPublished(action)
      return done(
        NextResponse.json({ ok: true, platform: action.platform, linked: wrote }),
        wrote,
        wrote
          ? `${action.platform} → ${action.permalink}`
          : action.backfillOnly ? 'no url yet' : 'no url on the event',
      )
    }
    case 'platform_failed': {
      const settled = await platformFailed(action)
      return done(
        NextResponse.json({ ok: true, platform: action.platform, failed: settled }),
        settled, `${action.platform}: ${action.error}`,
      )
    }
    case 'external_post': {
      // Somebody posted this in the platform's own app. If it is one of ours —
      // a scheduler who posted by hand and pasted the link onto the item card —
      // the client gets the same numbers as any other post. If it is not, this
      // is one indexed read that matches nothing.
      const { linkExternalPostFromWebhook } = await import('./external-post-match')
      const { matched } = await linkExternalPostFromWebhook({
        providerPostId: action.postId,
        platform: action.platform,
        url: action.url,
        publishedAt: action.publishedAt,
        profileId: action.profileId,
      }).catch(e => {
        console.error('could not link the external post', action.postId, e)
        return { matched: null as string | null }
      })
      return done(
        NextResponse.json({ ok: true, external: action.postId, matched }),
        Boolean(matched),
        matched ? `linked to item ${matched}` : 'not one of ours',
      )
    }

    case 'cancelled': {
      const settled = await postCancelled(action.postId)
      return done(NextResponse.json({ ok: true, cancelled: settled }), settled)
    }
    case 'scheduled': {
      const known = await postScheduledConfirmed(action.postId)
      return done(
        NextResponse.json({ ok: true, known }), known,
        known ? undefined : 'no job holds this post id',
      )
    }

    case 'account_inactive':
      return done(await accountInactive(action.accountId), true)
    case 'account_connected': {
      const synced = await accountConnected(action)
      return done(
        NextResponse.json({ ok: true, resynced: synced }), synced,
        synced ? undefined : 'no client holds this profile yet',
      )
    }

    // A comment and a DM both mean the same thing to this dashboard: the Inbox
    // is now behind. The comment→DM automations themselves run INSIDE Zernio —
    // we configure them through their API, we do not evaluate them — so there
    // is no matcher here to run early, and pretending otherwise would risk
    // sending a client's audience a second DM. Recording the delivery is what
    // lets the Inbox refresh without polling the provider on a timer.
    case 'comment':
      return done(
        NextResponse.json({ ok: true, comment: action.commentId }), true,
        action.text ? action.text.slice(0, 200) : undefined,
      )
    case 'inbox':
      return done(NextResponse.json({ ok: true, inbox: action.detail }), true)

    case 'review': {
      const told = await reviewReceived(action)
      return done(NextResponse.json({ ok: true, notified: told }), told)
    }
    case 'lead': {
      const told = await leadReceived(action)
      return done(NextResponse.json({ ok: true, notified: told }), told)
    }

    case 'ignore':
      // 200, never 4xx: an unrecognised payload answered with an error is
      // redelivered for ~51 hours and still unrecognised every time. One
      // structured line so a new event that starts arriving is discoverable
      // rather than invisible.
      console.warn(JSON.stringify({
        at: 'zernio.webhook', outcome: 'ignored', event, eventId, reason: action.reason,
      }))
      return done(NextResponse.json({ ok: true, ignored: action.reason }), false, action.reason)
  }
}

/**
 * Ask for this post's numbers in ten minutes' time.
 *
 * Fire-and-forget: Inngest being unreachable must not turn a delivery that
 * already did its real work into a 500 the provider replays for two days. The
 * half-hourly sweep still picks the post up regardless — this only shortens the
 * wait for the first set of figures.
 */
async function scheduleFirstAnalyticsFetch(providerPostId: string): Promise<void> {
  try {
    const { inngest } = await import('@/app/inngest/client')
    await inngest.send({
      name: 'app/social.post.published',
      data: { providerPostId },
    })
  } catch (e) {
    console.error('could not schedule the first analytics fetch', providerPostId, e)
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
