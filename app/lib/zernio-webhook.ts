import 'server-only'
import { NextResponse } from 'next/server'
import { table } from '@/lib/db'
import type { ProviderWebhook, PublishJob, SocialAccount } from '@/lib/db-types'
import { decryptSecret } from './secret-box'
import {
  keepLive, readPlatformResults, resultsForAll, resultsFromRemote, urlBelongsTo,
  type OutcomeJob, type PlatformOutcome,
} from './post-outcome-core'
import { isStillProcessing, platformErrorWords, type RemotePlatformRow } from './publish-core'
import { authorizeDelivery, parseZernioEvent } from './zernio-webhook-core'
import {
  claimDelivery, finishDelivery, releaseDelivery,
  platformPublished, platformFailed, postCancelled, postScheduledConfirmed,
  accountConnected, accountNeedsReconnecting, reviewReceived, leadReceived,
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
    const rows = await table<ProviderWebhook>('provider_webhooks').list({
      by: { provider: 'zernio', active: true },
    })
    for (const row of rows) {
      const packed = row.secret_encrypted
      if (!packed) continue
      // a secret we cannot decrypt (CREDENTIALS_KEY rotated) must not take the
      // whole endpoint down with it — the other secrets still work
      try { secrets.push(decryptSecret(packed)) } catch { /* skip */ }
    }
  } catch {
    // the registrations may be unreadable; the env var alone is a complete setup
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
      return done(await failed(action.postId, action.error, action.rows), true, action.error)

    case 'platform_published': {
      const wrote = await platformPublished(action)
      // …and the network's own record says it is out, with its own link, so
      // the post can be recorded without waiting for the whole post's rollup
      await tellPosts(await noteNetwork(action.postId, action.platform, { status: 'published', url: action.permalink }))
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
      // the job's one word says failed; its per-network record has to say
      // WHICH network, or the post reads "still going out" for ever
      const noted = await noteNetwork(action.postId, action.platform, { status: 'failed', reason: action.error })
      await tellPosts(noted.length ? noted : await jobIdsFor(action.postId))
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
      // the jobs still open BEFORE the provider's cancel settles them: those
      // are the ones it dropped. One we cancelled ourselves is marked
      // 'cancelled' on our side as we do it, so it is not here and is not
      // called lost (see production-publish.recordPostOutcome for the moment
      // between our provider call and our own write).
      const open = await openJobIdsFor(action.postId)
      const settled = await postCancelled(action.postId)
      // nothing went out on its networks: the post comes back to Ready to
      // post saying so (T18), instead of sitting booked for a job that is gone
      if (settled) await tellPosts(open, { lost: true })
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
    // is now behind. Zernio's comment→DM automations run INSIDE Zernio — we do
    // not evaluate those. OUR APP's own automations (runner 'app', 30 Sep 2026)
    // run here, off this event: runAppAutomations claims each person once, so
    // a redelivered comment never sends a second DM. Recording the delivery is
    // what lets the Inbox refresh without polling the provider on a timer.
    case 'comment':
      if (!action.own) {
        const { runAppAutomations } = await import('./comment-automation')
        await runAppAutomations({
          commentId: action.commentId, accountId: action.accountId, platformPostId: action.platformPostId,
          text: action.text, authorId: action.authorId, authorUsername: action.authorUsername, authorName: action.authorName,
        })
      }
      // EVERY TOUCH IS NOTED AS IT HAPPENS (28 Sep 2026: "track every touch point"): who commented, on which account,
      // for the People page — not only when somebody opens the Inbox. The words are not kept here.
      if (action.authorUsername && action.accountId && !action.own) {
        await noteTouch({ username: action.authorUsername, name: action.authorName ?? null, kind: 'comment', account_id: action.accountId, conversation_id: null, post_id: action.platformPostId })
      }
      return done(
        NextResponse.json({ ok: true, comment: action.commentId }), true,
        action.text ? action.text.slice(0, 200) : undefined,
      )
    case 'inbox':
      // AN INCOMING DM WAKES THE ACQUISITION AGENT AT ONCE (21 Sep 2026; acq-agent.ts). Only the fact and
      // the handle travel: the job checks the account is MD Media's own, and reads the thread itself.
      // Best effort — a webhook is never failed because a job could not be queued.
      // …and every incoming DM is a touch on the People page, whoever's account it came to (28 Sep 2026)
      if (action.detail === 'message.received' && action.incoming !== false && action.senderUsername && action.accountId) {
        await noteTouch({ username: action.senderUsername, name: action.senderName ?? null, kind: 'message', account_id: action.accountId, conversation_id: action.conversationId, post_id: null })
      }
      if (action.detail === 'message.received' && action.incoming !== false && action.senderUsername && action.accountId) {
        try {
          const { inngest } = await import('../inngest/client')
          await inngest.send({ name: 'app/acquisition.dm.received', data: { account_id: action.accountId, conversation_id: action.conversationId, username: action.senderUsername, name: action.senderName ?? null } })
        } catch (e) { console.error('[zernio webhook] could not wake the acquisition agent:', e) }
      }
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

/** a touch for the People page — best effort: a webhook never fails because a note could not be written */
async function noteTouch(t: { username: string; name: string | null; kind: 'comment' | 'message'; account_id: string; conversation_id: string | null; post_id: string | null }): Promise<void> {
  try {
    const { recordTouches } = await import('./inbox-people')
    await recordTouches([{ ...t, at: new Date().toISOString() }])
  } catch (e) { console.error('[zernio webhook] could not note the touch:', e) }
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
  const jobs = table<PublishJob>('publish_jobs')
  let rows: PublishJob[]
  try {
    // the claim: only a job still in an open status is settled here, so a
    // repeat delivery moves nothing
    const open = await jobs.list({
      where: j => j.provider_post_id === postId && OPEN_STATUSES.includes(j.status),
    })
    // the per-channel record too: without it a job the webhook settled kept
    // "scheduled" on every channel under a "published" job (10 Sep 2026)
    const live = platforms.map(p => p.toLowerCase())
    /** every channel the job was sent to, lower-cased */
    const wantedOf = (j: PublishJob) => (Array.isArray(j.targets) ? j.targets : [])
      .map(t => String((t as { platform?: unknown })?.platform ?? '').toLowerCase()).filter(Boolean)
    // THE SAME RULE THE RECONCILER KEEPS: a post is posted when EVERY channel
    // is live. A delivery that names only some of them settles those
    // channels and leaves the job booked — the 1:15 am post of 10 Sep 2026
    // was called posted, and the team emailed, on Instagram alone
    const settled: PublishJob[] = []
    const partial: PublishJob[] = []
    for (const j of open) {
      const wanted = wantedOf(j)
      const everyChannelLive = live.length === 0 || wanted.length === 0 || wanted.every(p => live.includes(p))
      const stored = readPlatformResults(j.platform_results) ?? []
      const results = keepLive(stored, resultsForAll(j as unknown as OutcomeJob, 'published', { at: now })
        .map(o => live.length && !live.includes(o.platform) ? { ...o, status: 'pending' as const, url: null } : o)
        // ONE link for the whole post lands only on the network it is from —
        // it used to go on every network, so LinkedIn's row carried an
        // Instagram link (audit L1). A network's own link, noted earlier by
        // its platform event, is kept.
        .map(o => o.status !== 'published' ? o : {
          ...o,
          url: urlBelongsTo(o.platform, permalink, wanted.length === 1) ? permalink
            : stored.find(s => s.platform === o.platform && s.url)?.url ?? null,
        }))
      if (everyChannelLive) {
        const row = await jobs.update(j.id, {
          status: 'published', published_at: now, updated_at: now, error: null,
          ...(permalink ? { permalink } : {}),
          platform_results: results,
        })
        if (row) settled.push(row)
      } else {
        await jobs.update(j.id, {
          updated_at: now,
          ...(permalink ? { permalink } : {}),
          platform_results: results,
        })
        partial.push(j)
      }
    }
    if (partial.length && !settled.length) {
      // the networks already up get their own links on their own rows; the
      // post stays booked for the rest
      await tellPosts(partial.map(j => j.id))
      return NextResponse.json({ ok: true, partial: partial.map(j => j.id), waitingOn: partial.map(j => wantedOf(j).filter(p => !live.includes(p))) })
    }
    rows = settled
  } catch (e) {
    // a real database failure SHOULD be retried by the provider
    const message = e instanceof Error ? e.message : String(e)
    console.error('zernio webhook could not settle the job:', postId, message)
    return NextResponse.json({ error: message }, { status: 500 })
  }

  if (!rows.length) {
    // Either a repeat delivery or a job `runPublishJob` already settled
    // synchronously. Both are no-ops — except that the platform assigns the
    // permalink after the fact, so a link we did not have before is still
    // worth keeping. Writing it only where it is null keeps that idempotent.
    if (permalink) {
      const blank = await jobs.list({
        where: j => j.provider_post_id === postId && j.permalink == null,
      })
      await Promise.all(blank.map(j => jobs.update(j.id, { permalink })))
    }
    // …and a job already settled (a network failed first, or the run answered
    // before this delivery) still hears which networks this says are live
    const noted: string[] = []
    for (const p of platforms) noted.push(...await noteNetwork(postId, p, { status: 'published', url: permalink }))
    await tellPosts(noted)
    return NextResponse.json({ ok: true, duplicate: true })
  }

  // the publish recorder owns writing this back: the post (T16/T17), each
  // network's schedule row with its own link, and the edit card's roll-up
  // through the ordinary machine. Imported lazily (tellPosts) so this module
  // does not pull the workflow machine into every signature check.
  await tellPosts(rows.map(j => j.id))
  return NextResponse.json({ ok: true, published: rows[0].id })
}

/**
 * The provider could not post it.
 *
 * The job is marked failed and the content item is deliberately left where it
 * is — still "Scheduled", which is true: it is booked and it did not go out.
 * Moving it backwards would erase the scheduler's work over a failure that is
 * usually a re-auth away from being retried.
 */
async function failed(postId: string, message: string, rows?: RemotePlatformRow[]): Promise<Response> {
  const jobs = table<PublishJob>('publish_jobs')
  let open: PublishJob[]
  try {
    open = await jobs.list({
      where: j => j.provider_post_id === postId && OPEN_STATUSES.includes(j.status),
    })
    const now = new Date().toISOString()
    // a partial names its channels: the live one keeps `published` and its link, only the refused ones
    // read failed — the 7 pm post of 24 Sep 2026 was live on Instagram and written down as failed there
    const permalink = rows?.find(r => r.platformPostUrl)?.platformPostUrl ?? null
    const recorded = new Map(open.map(j => [j.id, rows?.length
      ? resultsFromRemote(j as unknown as OutcomeJob, rows, 'failed', now)
      : resultsForAll(j as unknown as OutcomeJob, 'failed', { at: now, reason: message })]))
    await Promise.all(open.map(j => jobs.update(j.id, {
      status: 'failed', error: message, updated_at: now,
      ...(permalink && !j.permalink ? { permalink } : {}),
      platform_results: recorded.get(j.id),
    })))
    // a network that timed out is re-sent by the app, one at a time (24 Sep 2026). Imported lazily, like the
    // workflow above, so verifying a signature does not load the publisher.
    try {
      const { resendTimedOut } = await import('./publish')
      for (const j of open) await resendTimedOut(j, recorded.get(j.id) ?? [])
    } catch (e) {
      console.error('[zernio webhook] re-send failed to queue:', e instanceof Error ? e.message : e)
    }
    // AFTER the re-sends: a network being re-sent is still going out, so the
    // post stays booked for it (T17/T18 only once every network has answered)
    await tellPosts(open.map(j => j.id))
    // a job an earlier per-network event already settled is not open any
    // more, but this rollup still says what each network did — without it a
    // network that went out after its sibling failed was never written down
    if (rows?.length) {
      const noted: string[] = []
      for (const r of rows) {
        const st = String(r.status ?? '').toLowerCase()
        const platform = String(r.platform ?? r.name ?? '')
        if (['published', 'posted', 'success'].includes(st)) {
          noted.push(...await noteNetwork(postId, platform, { status: 'published', url: r.platformPostUrl ?? null }))
        } else if (st === 'failed' && !isStillProcessing(r)) {
          noted.push(...await noteNetwork(postId, platform, { status: 'failed', reason: r.errorMessage ?? r.error ?? null }))
        }
      }
      await tellPosts(noted.filter(id => !open.some(j => j.id === id)))
    }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    console.error('zernio webhook could not record the failure:', postId, detail)
    return NextResponse.json({ error: detail }, { status: 500 })
  }
  if (!open.length) return NextResponse.json({ ok: true, duplicate: true })
  return NextResponse.json({ ok: true, failed: open[0].id })
}

/**
 * An account was revoked or expired at the platform.
 *
 * Marking the row was shipped 20 Aug: without it a dead account is only
 * discovered when a post fails, which is after somebody has noticed nothing
 * went out. Marking it, though, only told the APP. Nobody was told — and the
 * posts already booked onto that channel sat on the calendar looking approved
 * and would not have gone out. So the client's account manager is told, once,
 * with the link to the page that fixes it.
 *
 * CLAIMED, not written: `active: false` is set only on a row that is still
 * active, so the notification hangs off the TRANSITION rather than off the
 * delivery. A duplicate webhook (or a second event id for the same drop, which
 * `claimDelivery` cannot dedupe) finds nothing to change and tells nobody a
 * second time. A failed notification never fails the delivery — the row is
 * already correct, and a 500 here would only earn a redelivery that does
 * nothing.
 */
async function accountInactive(accountId: string): Promise<Response> {
  const dropped: SocialAccount[] = []
  try {
    const accounts = table<SocialAccount>('social_accounts')
    const rows = await accounts.list({ where: a => a.provider_account_id === accountId })
    for (const a of rows) {
      const taken = await accounts.claim(a.id, cur =>
        (cur && cur.active !== false ? { ...cur, active: false } : null))
      if (taken.claimed) dropped.push(taken.row)
    }
  } catch (e) {
    console.error('zernio webhook account update failed:', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }

  const droppedAt = new Date().toISOString()
  for (const a of dropped) {
    await accountNeedsReconnecting(a, droppedAt)
      .catch(e => console.error('could not say that an account needs reconnecting:', a.id, e))
  }
  return NextResponse.json({ ok: true, marked: accountId, told: dropped.length })
}

/**
 * Tell the posts what these jobs came to — the publish recorder, through
 * publish.tellThePost (lazily imported, best effort: a delivery that did its
 * real work is never failed over the bookkeeping).
 */
async function tellPosts(jobIds: readonly string[], opts: { lost?: boolean } = {}): Promise<void> {
  if (jobIds.length === 0) return
  try {
    const { tellThePost } = await import('./publish')
    for (const id of new Set(jobIds)) await tellThePost(id, opts)
  } catch (e) {
    console.error('[zernio webhook] could not record the outcome on its post:', e instanceof Error ? e.message : e)
  }
}

async function jobIdsFor(postId: string): Promise<string[]> {
  const rows = await table<PublishJob>('publish_jobs').list({ where: j => j.provider_post_id === postId }).catch(() => [] as PublishJob[])
  return rows.map(j => j.id)
}

async function openJobIdsFor(postId: string): Promise<string[]> {
  const rows = await table<PublishJob>('publish_jobs')
    .list({ where: j => j.provider_post_id === postId && OPEN_STATUSES.includes(j.status) })
    .catch(() => [] as PublishJob[])
  return rows.map(j => j.id)
}

/**
 * One network's own word, written into its row of the job's per-network
 * record (`platform_results`) — claimed, so two deliveries cannot trample
 * each other. A network already live stays live (keepLive: a stale failure
 * never takes back a post that went out), and a link is kept only on the
 * network it belongs to. Returns the jobs it changed.
 */
export async function noteNetwork(
  postId: string,
  platform: string | null | undefined,
  next: { status: 'published' | 'failed'; url?: string | null; reason?: string | null },
): Promise<string[]> {
  const p = String(platform ?? '').toLowerCase()
  if (!p || !postId) return []
  const jobs = table<PublishJob>('publish_jobs')
  const rows = await jobs.list({ where: j => j.provider_post_id === postId }).catch(() => [] as PublishJob[])
  const touched: string[] = []
  for (const j of rows) {
    try {
      const taken = await jobs.claim(j.id, cur => {
        if (!cur) return null
        // no record yet: every other network has simply not answered — the
        // job's one status word was set about ONE network (platformFailed)
        // and must not be read as the verdict on all of them
        const list: PlatformOutcome[] = readPlatformResults(cur.platform_results)
          ?? resultsForAll(cur as unknown as OutcomeJob, 'pending', { at: new Date().toISOString() })
        const i = list.findIndex(o => o.platform === p)
        if (i < 0) return null
        const had = list[i]
        if (had.status === 'published' && next.status !== 'published') return null
        const now = new Date().toISOString()
        const row: PlatformOutcome = next.status === 'published'
          ? {
            ...had, status: 'published', reason: null,
            url: urlBelongsTo(p, next.url, list.length === 1) ? next.url ?? null : had.url,
            at: had.status === 'published' ? had.at : now,
          }
          : { ...had, status: 'failed', url: null, reason: platformErrorWords(next.reason) || next.reason || 'no reason given', at: now }
        if (had.status === row.status && had.url === row.url && had.reason === row.reason) return null
        const out = [...list]
        out[i] = row
        return { ...cur, platform_results: out, updated_at: now }
      })
      if (taken.claimed) touched.push(j.id)
    } catch (e) {
      console.error('[zernio webhook] could not note', p, 'on job', j.id, e instanceof Error ? e.message : e)
    }
  }
  return touched
}
