import 'server-only'
import { DbError, table } from '@/lib/db'
import { attachOne } from '@/lib/db-join'
import type {
  Client, ContentAsset, PostAnalytic, PublishJob, ScheduleEntry, SocialAccount,
  TeamUser, TeamUserClient, WebhookDelivery,
} from '@/lib/db-types'
import { notify } from './mailer'
import type { ZernioAction } from './zernio-webhook-core'

/**
 * What each Zernio webhook event actually DOES to this database.
 *
 * `zernio-webhook.ts` owns the delivery — signature, parse, dispatch, status
 * code. This file owns the consequences, one exported function per event
 * family, so that "what does post.platform.published change?" is answerable by
 * reading twenty lines rather than by tracing a switch through a request
 * handler.
 *
 * Three rules hold everywhere in here:
 *
 *   1. **Every write is idempotent on its own**, not merely because the
 *      delivery log deduped it. Zernio retries up to 7 times over ~51 hours;
 *      the log is the first line of defence, a status re-check or a
 *      null-guarded back-fill is the second, and only the second survives the
 *      log being unreadable.
 *   2. **A link a human set is never overwritten.** Every permalink write
 *      only fills a null. The provider is allowed to fill a blank; it is not
 *      allowed to correct a person.
 *   3. **Nothing here throws into the handler.** A failed side effect must not
 *      turn a delivery into a non-2xx, because a non-2xx is redelivered for two
 *      days and would replay every side effect that DID work alongside it. The
 *      exception is a genuine database error on the primary write, which the
 *      caller does surface as a 500 — that one we want retried.
 */

/* ── the delivery log, which is also the idempotency key ─────────────────── */

export type DeliveryClaim =
  /** we own this event; do the work */
  | { kind: 'claimed'; id: string }
  /** somebody already recorded this event id — a retry. Do nothing. */
  | { kind: 'duplicate' }
  /** no log table, or no event id to key on. Proceed on the handlers' own
   *  idempotency, which every one of them has. */
  | { kind: 'unlogged' }

/**
 * The composite key (provider, provider_event_id), as one value.
 *
 * A JSON tree indexes one field at a time, so the pair is carried as a single
 * derived column and declared unique in lib/db.ts's UNIQUE_COLUMNS — which
 * makes the insert itself the claim, decided by the database's own rule on
 * /mdm/uniq. Mirrored in scripts/migrate-core.mjs for the backfill.
 */
export const providerEventKey = (provider: string, eventId: string) => `${provider}__${eventId}`

/**
 * Claim one delivery.
 *
 * The uniqueness that decides this is COMPOSITE — (provider, provider_event_id)
 * — and it is now enforced by the database: the insert takes the unique
 * pointer for the pair, or is refused. A duplicate delivery is the loser of
 * that claim, not the result of a lookup that happened to run first.
 *
 * An event with no id cannot be deduped this way and is NOT dropped — the
 * account webhook that has been in production since 20 Aug predates the
 * envelope, and refusing it would be a regression to fix a hypothetical.
 */
export async function claimDelivery(event: string, eventId: string | null): Promise<DeliveryClaim> {
  if (!eventId) return { kind: 'unlogged' }
  try {
    // The unique index Postgres held was composite, on (provider,
    // provider_event_id) — so the claim is a single derived column carrying
    // both, and the insert takes the /mdm/uniq pointer for it or is refused
    // by the database. Listing the table and then inserting is two
    // operations, and two redeliveries arriving together both pass the list.
    const row = await table('webhook_deliveries').insert({
      provider: 'zernio',
      event,
      provider_event_id: eventId,
      provider_event_key: providerEventKey('zernio', eventId),
      received_at: new Date().toISOString(),
      handled: false,
      note: null,
    })
    return { kind: 'claimed', id: row.id }
  } catch (e) {
    // a losing race on the id is a duplicate, not an outage
    if (e instanceof DbError && e.code === 'unique') return { kind: 'duplicate' }
    return { kind: 'unlogged' }
  }
}

/** Close the loop on a claimed delivery: did we act, and what happened? */
export async function finishDelivery(
  claim: DeliveryClaim, handled: boolean, note?: string,
): Promise<void> {
  if (claim.kind !== 'claimed') return
  try {
    await table<WebhookDelivery>('webhook_deliveries')
      .update(claim.id, { handled, note: note?.slice(0, 500) ?? null })
  } catch { /* the log is bookkeeping; never fail a delivery over it */ }
}

/**
 * Give the claim back.
 *
 * Called when a delivery is about to be answered with a non-2xx. The provider
 * will redeliver it, and a claim left standing would make that redelivery look
 * like a duplicate and do nothing — the failure would become permanent, which
 * is precisely the outcome the retries exist to prevent. Deleting the row is
 * safe: it holds no state, only the fact that we saw the event.
 */
export async function releaseDelivery(claim: DeliveryClaim): Promise<void> {
  if (claim.kind !== 'claimed') return
  try {
    await table<WebhookDelivery>('webhook_deliveries').remove(claim.id)
  } catch { /* the retry will be seen as a duplicate instead — visible, not silent */ }
}

export type DeliveryStats = {
  /** most recent delivery of any event, ISO */
  last_at: string | null
  /** deliveries in the last 24 hours */
  today: number
  /** true once ANYTHING has ever arrived — the honest version of "it works" */
  ever: boolean
}

/**
 * What the Integrations card says out loud.
 *
 * "A registration row exists" only proves the button was pressed. A webhook
 * registered against a stale URL, or auto-disabled by the provider after ten
 * consecutive failures, looks exactly like a healthy one from the registration
 * side. A delivery timestamp does not.
 */
export async function webhookDeliveryStats(provider = 'zernio'): Promise<DeliveryStats> {
  const empty: DeliveryStats = { last_at: null, today: 0, ever: false }
  try {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString()
    const deliveries = table<WebhookDelivery>('webhook_deliveries')
    const [latest, today] = await Promise.all([
      deliveries.list({
        by: { provider },
        orderBy: [['received_at', 'desc']],
        limit: 1,
      }),
      deliveries.count({
        by: { provider },
        where: r => r.received_at >= since,
      }),
    ])
    const last = latest[0]?.received_at ?? null
    return { last_at: last, today, ever: Boolean(last) }
  } catch {
    return empty
  }
}

/**
 * Events that mean "the Inbox page is showing something out of date".
 *
 * The Inbox has no local message store — it renders conversations read LIVE
 * from the provider on every visit — so there is nothing for a message event to
 * be written INTO. What it can do is say that the live view is now behind, and
 * that is what this list is for: the page asks our own database "has anything
 * landed since I loaded?", which is one indexed local query, instead of asking
 * the provider for the whole conversation list on a timer.
 */
const INBOX_ACTIVITY_EVENTS = [
  'message.received', 'message.sent', 'message.edited', 'message.deleted',
  'reaction.received', 'conversation.started', 'comment.received',
]

export type InboxActivity = { last_at: string | null; since_count: number }

/** Has anything inbox-shaped arrived (since `sinceIso`, if given)? */
export async function inboxActivity(sinceIso?: string | null): Promise<InboxActivity> {
  try {
    const deliveries = table<WebhookDelivery>('webhook_deliveries')
    const latest = await deliveries.list({
      by: { provider: 'zernio' },
      where: r => INBOX_ACTIVITY_EVENTS.includes(r.event),
      orderBy: [['received_at', 'desc']],
      limit: 1,
    })
    const last = latest[0]?.received_at ?? null
    if (!sinceIso || !last) return { last_at: last, since_count: 0 }

    const since_count = await deliveries.count({
      by: { provider: 'zernio' },
      where: r => INBOX_ACTIVITY_EVENTS.includes(r.event) && r.received_at > sinceIso,
    })
    return { last_at: last, since_count }
  } catch {
    // the deliveries could not be read — the page falls back to loading on
    // visit, which is exactly what it did before this existed
    return { last_at: null, since_count: 0 }
  }
}

/* ── posts ───────────────────────────────────────────────────────────────── */

/** Statuses a webhook may move a job out of. A settled job is left alone. */
const OPEN_STATUSES = ['queued', 'publishing', 'scheduled']

type PlatformPublished = Extract<ZernioAction, { kind: 'platform_published' }>

/**
 * One platform inside a post finished — write its live URL everywhere the
 * dashboard shows a link, and nowhere else.
 *
 * This event is the difference between a scheduler having a link to send the
 * client now and having one after the next analytics sweep. It deliberately
 * does NOT settle the job: the post-level rollup (`post.published`) does that,
 * and a post to three platforms is not finished because one of them is.
 * `post.tiktok.url_resolved` arrives minutes later carrying only the URL, and
 * takes exactly the same path — a back-fill is a back-fill.
 *
 * Three destinations, all null-guarded:
 *   publish_jobs.permalink        the operator's link, on the posting card
 *   schedule_entries.live_url     the client's link, in the portal
 *   post_analytics.platform_post_url  the analytics row, if one exists yet
 */
export async function platformPublished(action: PlatformPublished): Promise<boolean> {
  const { postId, platform, permalink } = action
  if (!permalink) return false

  const jobsTable = table<PublishJob>('publish_jobs')
  const jobs = await jobsTable.list({ where: j => j.provider_post_id === postId })
  const job = jobs[0]

  // only ever onto a null, on all four: the provider may fill a blank, never
  // correct a link somebody set by hand.
  await Promise.all(jobs
    .filter(j => j.permalink == null)
    .map(j => jobsTable.update(j.id, { permalink })))

  const analytics = table<PostAnalytic>('post_analytics')
  const analyticRows = await analytics.list({
    where: a => a.provider_post_id === postId && a.platform_post_url == null,
  })
  await Promise.all(analyticRows.map(a => analytics.update(a.id, { platform_post_url: permalink })))

  if (job?.content_item_id && platform) {
    // the PLATFORM's row, not every row on the item: a post that went to
    // Instagram and LinkedIn has two links, and stamping one over both would
    // send a client to the wrong place.
    const entries = table<ScheduleEntry>('schedule_entries')
    const rows = await entries.list({
      by: { item_id: job.content_item_id, platform },
      where: e => e.live_url == null,
    })
    await Promise.all(rows.map(e => entries.update(e.id, { live_url: permalink })))
  }

  const assets = table<ContentAsset>('content_assets')
  const assetRows = await assets.list({
    where: a => a.provider_post_id === postId && a.post_url == null,
  })
  await Promise.all(assetRows.map(a => assets.update(a.id, { post_url: permalink })))

  return true
}

type PlatformFailed = Extract<ZernioAction, { kind: 'platform_failed' }>

/**
 * One platform failed permanently.
 *
 * The provider only fires this after it has stopped retrying, so it is a
 * verdict rather than a symptom. The job is marked failed with the platform's
 * own words — "The channel refused the post" with no reason is the message
 * that has cost the most time to act on.
 *
 * The open-status check is the idempotency: the rollup `post.failed` that
 * follows finds the job already settled and moves nothing.
 */
export async function platformFailed(action: PlatformFailed): Promise<boolean> {
  const label = action.platform ? `${action.platform}: ${action.error}` : action.error
  const jobs = table<PublishJob>('publish_jobs')
  const open = await jobs.list({
    where: j => j.provider_post_id === action.postId && OPEN_STATUSES.includes(j.status),
  })
  await Promise.all(open.map(j => jobs.update(j.id, {
    status: 'failed', error: label.slice(0, 1000), updated_at: new Date().toISOString(),
  })))
  return open.length > 0
}

/**
 * The publishing job was cancelled at the provider.
 *
 * Nothing was posted (had a platform already published, the rollup would be
 * `post.partial` instead), so the content item stays exactly where it is —
 * still Scheduled, which remains true: it is booked and it did not go out.
 * Walking it backwards would erase the scheduler's work over something a
 * re-queue fixes.
 *
 * The note lands in two places a person actually looks: `publish_jobs.error`,
 * which the posting card renders, and a `workflow_activity` row, which is the
 * item's own history.
 */
export async function postCancelled(postId: string): Promise<boolean> {
  const jobsTable = table<PublishJob>('publish_jobs')
  const open = await jobsTable.list({
    where: j => j.provider_post_id === postId && OPEN_STATUSES.includes(j.status),
  })
  await Promise.all(open.map(j => jobsTable.update(j.id, {
    status: 'cancelled',
    error: 'Cancelled at the publishing service — nothing was posted. Queue it again to send it.',
    updated_at: new Date().toISOString(),
  })))
  const job = open[0]
  if (!job) return false

  if (job.content_item_id) {
    try {
      await table('workflow_activity').insert({
        client_id: job.client_id ?? null,
        entity_type: 'content_item',
        entity_id: job.content_item_id,
        action: 'publish_cancelled',
        detail: 'The publishing service cancelled this post before it went out. '
          + 'It is still scheduled; queue it again to send it.',
      })
    } catch { /* the audit line is not worth failing a delivery over */ }
  }
  return true
}

/**
 * The provider has accepted the post and is holding it.
 *
 * Confirmation, not news: `runPublishJob` already wrote this row. It exists so
 * a job whose create response was lost — the request timed out after the
 * provider committed — still gets its `provider_post_id`, which is the join
 * key everything else in this file depends on. Nothing else is touched, and a
 * job that already knows its id matches zero rows.
 */
export async function postScheduledConfirmed(postId: string): Promise<boolean> {
  const jobs = await table<PublishJob>('publish_jobs').list({
    where: j => j.provider_post_id === postId,
    limit: 1,
  })
  return jobs.length > 0
}

/* ── accounts ────────────────────────────────────────────────────────────── */

type AccountConnected = Extract<ZernioAction, { kind: 'account_connected' }>

/**
 * A client just finished connecting an account.
 *
 * Until this arrives, the posting card says "no account connected" about a
 * channel that now works, and stays wrong until somebody opens the channels
 * page and presses refresh. Re-syncing the client's whole account list (rather
 * than inserting the one account off the payload) is deliberate: `listAccounts`
 * is the shape `social_accounts` was built from, so one code path keeps writing
 * those rows and the webhook cannot invent a row the sync would disagree with.
 *
 * The client is found through the profile the event names; failing that,
 * through an account row we already hold for the same profile — a RECONNECT
 * carries the same accountId we stored the first time.
 */
export async function accountConnected(action: AccountConnected): Promise<boolean> {
  const clientId = await clientForAccount(action)
  if (!clientId.clientId || !clientId.profileId) return false
  try {
    const { syncSocialAccounts } = await import('./publish')
    await syncSocialAccounts(clientId.clientId, clientId.profileId)
    return true
  } catch (e) {
    console.error('zernio webhook could not resync accounts', action.accountId, e)
    return false
  }
}

async function clientForAccount(
  action: { accountId: string; profileId: string | null },
): Promise<{ clientId: string | null; profileId: string | null }> {
  const clients = table<Client>('clients')
  if (action.profileId) {
    const found = (await clients.list({
      where: c => c.social_profile_id === action.profileId, limit: 1,
    }))[0]
    if (found) return { clientId: found.id, profileId: action.profileId }
  }
  // a reconnect: we already hold this account id from a previous sync
  const existing = (await table<SocialAccount>('social_accounts').list({
    where: a => a.provider_account_id === action.accountId, limit: 1,
  }))[0]
  if (!existing?.client_id) return { clientId: null, profileId: action.profileId }
  const client = await clients.get(existing.client_id)
  return {
    clientId: client?.id ?? null,
    profileId: action.profileId ?? client?.social_profile_id ?? null,
  }
}

/* ── people to tell ──────────────────────────────────────────────────────── */

/**
 * The client this connected account belongs to, and their account managers.
 *
 * Falls back to super admins for a client with nobody assigned — the same rule
 * `resolveAudience` uses in workflow.ts, for the same reason: an unassigned
 * client's review must not vanish because of a missing row.
 */
export async function accountManagersFor(providerAccountId: string | null): Promise<{
  clientId: string | null
  clientName: string
  people: { id: string; email: string; name: string }[]
}> {
  const none = { clientId: null, clientName: 'a client', people: [] as { id: string; email: string; name: string }[] }
  let clientId: string | null = null
  let clientName = 'a client'

  if (providerAccountId) {
    const account = (await table<SocialAccount>('social_accounts').list({
      where: a => a.provider_account_id === providerAccountId, limit: 1,
    }))[0]
    clientId = account?.client_id ?? null
  }
  if (clientId) {
    const client = await table<Client>('clients').get(clientId)
    clientName = client?.name || clientName
  }

  if (clientId) {
    // the link table points at team_users twice (team_user_id and
    // assigned_by); the person assigned to the client is team_user_id
    const links = await table<TeamUserClient>('team_user_clients').list({ by: { client_id: clientId } })
    const joined = await attachOne(links, 'team_user_id', 'team_users',
      ['id', 'email', 'name', 'role', 'active_status'])
    const ams = joined
      .map(r => r.team_users as unknown as
        { id: string; email: string; name: string; role: string; active_status: boolean } | null)
      .filter((u): u is { id: string; email: string; name: string; role: string; active_status: boolean } =>
        !!u && (u.role === 'account_manager' || u.role === 'super_admin') && u.active_status)
    if (ams.length > 0) {
      return { clientId, clientName, people: ams.map(u => ({ id: u.id, email: u.email, name: u.name })) }
    }
  }

  const admins = await table<TeamUser>('team_users').list({
    by: { role: 'super_admin', active_status: true },
  })
  return {
    ...none, clientId, clientName,
    people: admins.map(u => ({ id: u.id, email: u.email, name: u.name })),
  }
}

type Review = Extract<ZernioAction, { kind: 'review' }>

/**
 * A review landed. Tell the client's account manager — and stop there.
 *
 * Bell-only, not email: a five-star review is worth seeing, not worth
 * interrupting someone's inbox for, and a busy client would otherwise turn
 * their notifications off over it. `notify()` claims a dedupe key first, so the
 * seventh delivery of the same event notifies nobody a second time even if the
 * delivery log is not migrated.
 *
 * No automation beyond that, deliberately: replying to a review under a
 * client's name is a decision, not a workflow.
 */
export async function reviewReceived(action: Review): Promise<boolean> {
  const { clientName, people } = await accountManagersFor(action.accountId)
  if (people.length === 0) return false
  const stars = action.rating ? `${action.rating}★ ` : ''
  const verb = action.updated ? 'updated their review of' : 'reviewed'
  const subject = `${stars}${clientName} was ${action.updated ? 're-' : ''}reviewed`
  for (const person of people) {
    await notify({
      eventType: action.updated ? 'social.review.updated' : 'social.review.new',
      entityType: 'social_review',
      entityId: action.reviewId,
      recipientId: person.id,
      recipientEmail: person.email,
      subject,
      bodyHtml: `<p>Someone ${verb} <strong>${escapeHtml(clientName)}</strong>`
        + `${action.platform ? ` on ${escapeHtml(action.platform)}` : ''}.</p>`
        + (action.rating ? `<p><strong>${action.rating} out of 5</strong></p>` : '')
        + (action.text ? `<blockquote>${escapeHtml(action.text)}</blockquote>` : ''),
      bellOnly: true,
    })
  }
  return true
}

type Lead = Extract<ZernioAction, { kind: 'lead' }>

/**
 * A Lead Gen form was submitted on one of the client's ads.
 *
 * Notification only — it is NOT routed into the `leads` table. That pipeline is
 * MD Media's own enquiries (inbox → Haiku → leads); a lead captured on a
 * client's ad belongs to the client, and quietly mixing the two would corrupt
 * the agency's own lead report. The account manager is told; where it goes next
 * is theirs to decide.
 */
export async function leadReceived(action: Lead): Promise<boolean> {
  const { clientName, people } = await accountManagersFor(action.accountId)
  if (people.length === 0) return false
  const rows = Object.entries(action.fields).slice(0, 12)
    .map(([k, v]) => `<li><strong>${escapeHtml(k)}:</strong> ${escapeHtml(v)}</li>`).join('')
  for (const person of people) {
    await notify({
      eventType: 'social.lead.received',
      entityType: 'social_lead',
      entityId: action.leadId,
      recipientId: person.id,
      recipientEmail: person.email,
      subject: `New lead for ${clientName}`,
      bodyHtml: `<p>A lead form was submitted for <strong>${escapeHtml(clientName)}</strong>`
        + `${action.formName ? ` (${escapeHtml(action.formName)})` : ''}.</p>`
        + (rows ? `<ul>${rows}</ul>` : '<p>The form carried no fields.</p>'),
      bellOnly: true,
    })
  }
  return true
}

/** Minimal escaping — these strings are written by strangers on the internet. */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c))
}
