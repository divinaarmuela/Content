import 'server-only'
import { supabase } from '@/lib/supabase'
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
 *      the log is the first line of defence, a conditional UPDATE or a
 *      null-guarded back-fill is the second, and only the second survives the
 *      log table being unmigrated.
 *   2. **A link a human set is never overwritten.** Every permalink write is
 *      `.is('live_url', null)` / `.is('permalink', null)`. The provider is
 *      allowed to fill a blank; it is not allowed to correct a person.
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
 * Claim one delivery.
 *
 * `ignoreDuplicates` makes the unique index do the deciding: the insert either
 * returns a row (ours) or returns nothing (someone else's). There is no
 * "select then insert" window for a concurrent retry to slip through, which
 * matters because Zernio's retries are not spaced out enough to assume the
 * first attempt has finished.
 *
 * An event with no id cannot be deduped this way and is NOT dropped — the
 * account webhook that has been in production since 20 Aug predates the
 * envelope, and refusing it would be a regression to fix a hypothetical.
 */
export async function claimDelivery(event: string, eventId: string | null): Promise<DeliveryClaim> {
  if (!eventId) return { kind: 'unlogged' }
  try {
    const { data, error } = await supabase
      .from('webhook_deliveries')
      .upsert(
        { provider: 'zernio', event, provider_event_id: eventId },
        { onConflict: 'provider,provider_event_id', ignoreDuplicates: true },
      )
      .select('id')
      .maybeSingle()
    if (error) return { kind: 'unlogged' }   // table not migrated yet
    return data?.id ? { kind: 'claimed', id: data.id as string } : { kind: 'duplicate' }
  } catch {
    return { kind: 'unlogged' }
  }
}

/** Close the loop on a claimed delivery: did we act, and what happened? */
export async function finishDelivery(
  claim: DeliveryClaim, handled: boolean, note?: string,
): Promise<void> {
  if (claim.kind !== 'claimed') return
  try {
    await supabase.from('webhook_deliveries')
      .update({ handled, note: note?.slice(0, 500) ?? null })
      .eq('id', claim.id)
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
    await supabase.from('webhook_deliveries').delete().eq('id', claim.id)
  } catch { /* the retry will collide on the unique index instead — visible, not silent */ }
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
    const [latest, counted] = await Promise.all([
      supabase.from('webhook_deliveries')
        .select('received_at').eq('provider', provider)
        .order('received_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('webhook_deliveries')
        .select('id', { count: 'exact', head: true })
        .eq('provider', provider).gte('received_at', since),
    ])
    const last = (latest.data?.received_at as string | undefined) ?? null
    return { last_at: last, today: counted.count ?? 0, ever: Boolean(last) }
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
    const latest = await supabase.from('webhook_deliveries')
      .select('received_at')
      .eq('provider', 'zernio')
      .in('event', INBOX_ACTIVITY_EVENTS)
      .order('received_at', { ascending: false })
      .limit(1).maybeSingle()
    const last = (latest.data?.received_at as string | undefined) ?? null
    if (!sinceIso || !last) return { last_at: last, since_count: 0 }

    const { count } = await supabase.from('webhook_deliveries')
      .select('id', { count: 'exact', head: true })
      .eq('provider', 'zernio')
      .in('event', INBOX_ACTIVITY_EVENTS)
      .gt('received_at', sinceIso)
    return { last_at: last, since_count: count ?? 0 }
  } catch {
    // the table is not migrated — the page falls back to loading on visit,
    // which is exactly what it did before this existed
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

  const { data: jobs } = await supabase
    .from('publish_jobs')
    .select('id, content_item_id')
    .eq('provider_post_id', postId)
    .limit(1)
  const job = jobs?.[0]

  // `.is(…, null)` on all three: the provider may fill a blank, never correct
  // a link somebody set by hand.
  await supabase.from('publish_jobs')
    .update({ permalink })
    .eq('provider_post_id', postId)
    .is('permalink', null)

  await supabase.from('post_analytics')
    .update({ platform_post_url: permalink })
    .eq('provider_post_id', postId)
    .is('platform_post_url', null)

  if (job?.content_item_id && platform) {
    // the PLATFORM's row, not every row on the item: a post that went to
    // Instagram and LinkedIn has two links, and stamping one over both would
    // send a client to the wrong place.
    await supabase.from('schedule_entries')
      .update({ live_url: permalink })
      .eq('item_id', job.content_item_id as string)
      .eq('platform', platform)
      .is('live_url', null)
  }

  await supabase.from('content_assets')
    .update({ post_url: permalink })
    .eq('provider_post_id', postId)
    .is('post_url', null)

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
 * The conditional `in(status, OPEN_STATUSES)` is the idempotency: the rollup
 * `post.failed` that follows finds the job already settled and moves nothing.
 */
export async function platformFailed(action: PlatformFailed): Promise<boolean> {
  const label = action.platform ? `${action.platform}: ${action.error}` : action.error
  const { data } = await supabase
    .from('publish_jobs')
    .update({ status: 'failed', error: label.slice(0, 1000), updated_at: new Date().toISOString() })
    .eq('provider_post_id', action.postId)
    .in('status', OPEN_STATUSES)
    .select('id')
  return (data ?? []).length > 0
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
  const { data } = await supabase
    .from('publish_jobs')
    .update({
      status: 'cancelled',
      error: 'Cancelled at the publishing service — nothing was posted. Queue it again to send it.',
      updated_at: new Date().toISOString(),
    })
    .eq('provider_post_id', postId)
    .in('status', OPEN_STATUSES)
    .select('id, client_id, content_item_id')
  const job = (data ?? [])[0]
  if (!job) return false

  if (job.content_item_id) {
    try {
      await supabase.from('workflow_activity').insert({
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
  const { data } = await supabase
    .from('publish_jobs')
    .select('id, status, provider_post_id')
    .eq('provider_post_id', postId)
    .limit(1)
  return (data ?? []).length > 0
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
  if (action.profileId) {
    const { data } = await supabase
      .from('clients').select('id').eq('social_profile_id', action.profileId).maybeSingle()
    if (data?.id) return { clientId: data.id as string, profileId: action.profileId }
  }
  // a reconnect: we already hold this account id from a previous sync
  const { data: existing } = await supabase
    .from('social_accounts').select('client_id')
    .eq('provider_account_id', action.accountId).maybeSingle()
  if (!existing?.client_id) return { clientId: null, profileId: action.profileId }
  const { data: client } = await supabase
    .from('clients').select('id, social_profile_id').eq('id', existing.client_id).maybeSingle()
  return {
    clientId: (client?.id as string) ?? null,
    profileId: action.profileId ?? (client?.social_profile_id as string | null) ?? null,
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
    const { data: account } = await supabase
      .from('social_accounts').select('client_id')
      .eq('provider_account_id', providerAccountId).maybeSingle()
    clientId = (account?.client_id as string | null) ?? null
  }
  if (clientId) {
    const { data: client } = await supabase.from('clients').select('name').eq('id', clientId).maybeSingle()
    clientName = (client?.name as string) || clientName
  }

  if (clientId) {
    const { data } = await supabase
      .from('team_user_clients')
      // the FK must be named — team_user_clients links to team_users twice
      // (team_user_id and assigned_by) and the bare embed is ambiguous
      .select('team_users!team_user_clients_team_user_id_fkey!inner(id, email, name, role, active_status)')
      .eq('client_id', clientId)
    const ams = (data ?? [])
      .map(r => r.team_users as unknown as
        { id: string; email: string; name: string; role: string; active_status: boolean })
      .filter(u => (u.role === 'account_manager' || u.role === 'super_admin') && u.active_status)
    if (ams.length > 0) {
      return { clientId, clientName, people: ams.map(u => ({ id: u.id, email: u.email, name: u.name })) }
    }
  }

  const { data: admins } = await supabase
    .from('team_users').select('id, email, name')
    .eq('role', 'super_admin').eq('active_status', true)
  return { ...none, clientId, clientName, people: (admins ?? []) as { id: string; email: string; name: string }[] }
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
