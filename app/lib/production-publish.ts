import 'server-only'
import { announceItemChange } from './production-live'
import { supabase } from '@/lib/supabase'
import { queuePublishJob } from './publish'
import { getPublisher } from './publisher'
import {
  isPlatform, mediaTypeFor,
  type MediaItem, type PostKind, type Target,
} from './publish-core'
import { postSlides, slidesOf } from './version-files-core'
import { DEFAULT_TZ, safeZone } from './timezone-core'
import { STATUS_LABELS, type ItemStatus } from './workflow-core'
import { performTransition, systemActor, type ContentItem } from './workflow'
import { statusAfterQueue, systemActorLabel, systemPublishSteps } from './posting-card-core'
import { publishBlockReason } from './posting-approval-core'
import { postingApprovalStateOf } from './posting-approval'
import { analyticsForItems } from './post-analytics'
import type { PostMetrics } from './post-analytics-core'
import type { TeamUser } from './authz'

/**
 * The bridge from production to the outside world.
 *
 * Production owns the content and its approvals; social channels own the
 * accounts. This joins them: an approved item, its latest asset version, the
 * client's connected accounts for the platforms it targets, and the times the
 * scheduler set — turned into one publish job.
 *
 * One job per item, not per platform: the provider accepts many platforms in a
 * single post, and `publish_jobs` deliberately allows only one live job per
 * content item so an item can never be queued twice.
 */

/** Guess the media kind from a URL when no content type is available. */
function mediaFromUrl(url: string): MediaItem | null {
  const clean = url.split('?')[0].toLowerCase()
  const ext = clean.slice(clean.lastIndexOf('.') + 1)
  const byExt: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
    mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', avi: 'video/x-msvideo',
    pdf: 'application/pdf',
  }
  const type = mediaTypeFor(byExt[ext] ?? '')
  return type ? { url, type } : null
}

/** Map production's content_type onto a posting intent.
 *
 *  'video' is deliberately left unmapped: a video may be a Reel or an ordinary
 *  feed video, and the provider's own inference (a lone video becomes a Reel)
 *  is the better default than us guessing. */
export function contentTypeToKind(contentType: string, media: MediaItem[]): PostKind | undefined {
  switch (contentType) {
    case 'reel':     return 'reel'
    case 'story':    return 'story'
    case 'carousel': return 'carousel'
    case 'static':   return 'feed'
    default:         return media.length > 1 ? 'carousel' : undefined
  }
}

export type ItemPublishPlan = {
  itemId: string
  clientId: string
  caption: string
  media: MediaItem[]
  targets: Target[]
  scheduledFor: string | null
  /** the AUDIENCE's zone, which is the one the provider must be told about.
   *  `scheduledFor` is a UTC instant and needs no zone to be unambiguous —
   *  but the provider records a post's local publishing time, and handing it
   *  Melbourne for a Manila client puts the wrong hour on their own dashboard. */
  timezone: string
  /** platforms the item asks for but the client has no connected account for */
  missing: string[]
  blocked: string | null
}

/**
 * Work out exactly what would be published for an item, without doing it.
 *
 * The UI shows this before anyone commits, so a missing channel or an
 * unapproved item is visible up front rather than as a failed job later.
 */
export async function planItemPublish(itemId: string): Promise<ItemPublishPlan> {
  const { data: item } = await supabase
    .from('content_items')
    .select('id, client_id, caption, title, platform_targets, status, content_type')
    .eq('id', itemId)
    .maybeSingle()

  if (!item) throw new Error('Content item not found')

  const plan: ItemPublishPlan = {
    itemId,
    clientId: item.client_id as string,
    caption: (item.caption as string) || (item.title as string) || '',
    media: [],
    targets: [],
    scheduledFor: null,
    timezone: DEFAULT_TZ,
    missing: [],
    blocked: null,
  }

  // the client's own zone, read from the row that owns the audience
  const { data: client } = await supabase
    .from('clients').select('timezone').eq('id', item.client_id).maybeSingle()
  plan.timezone = safeZone(client?.timezone as string | null)

  // Only content that has cleared approval may go out. This is the whole point
  // of the workflow — publishing an item still in review would bypass it.
  const status = item.status as string
  if (!['approved_for_scheduling', 'scheduled', 'published'].includes(status)) {
    plan.blocked = `This item is "${STATUS_LABELS[status as ItemStatus] ?? status}" — it has not been approved for scheduling yet`
  }

  // …and the POST itself — the caption, the media, the hour — has its own
  // sign-off once the final-post gate has been used on this item. Read
  // tolerantly: a database without the column answers null, which is "the
  // gate is not in use", and nothing changes.
  if (!plan.blocked) {
    plan.blocked = publishBlockReason(await postingApprovalStateOf(itemId))
  }

  // newest version wins; that is the one reviewers signed off
  const { data: version } = await supabase
    .from('asset_versions')
    .select('file_url, files, drive_url, version_number')
    .eq('item_id', itemId)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  // ALL the slides, in the order the editor left them — that order is the
  // carousel. Taking only the first published a six-card set as one photo.
  const slides = postSlides(item.content_type as string, slidesOf(version))
  plan.media = slides.map(s => ({ url: s.url, type: s.type as MediaItem['type'] }))
  if (plan.media.length === 0) {
    // a version that is only a pasted review link still has one thing to post
    const url = (version?.drive_url as string) || ''
    const media = url ? mediaFromUrl(url) : null
    if (media) plan.media = [media]
  }

  // what the client actually has connected
  const { data: accounts } = await supabase
    .from('social_accounts')
    .select('platform, provider_account_id, active')
    .eq('client_id', item.client_id)
    .eq('active', true)

  // no explicit targets (the common case — nothing in the UI set them) means
  // every connected channel, rather than a permanently dead publish button
  let wanted = ((item.platform_targets as string[]) ?? []).map(p => p.toLowerCase())
  if (wanted.length === 0) {
    wanted = [...new Set((accounts ?? []).map(a => (a.platform as string).toLowerCase()))]
  }

  // production already knows what kind of content this is — carry it through
  // so a Reel is published as a Reel rather than a plain video post
  const kind = contentTypeToKind(item.content_type as string, plan.media)

  const byPlatform = new Map((accounts ?? []).map(a => [a.platform as string, a]))
  for (const p of wanted) {
    const account = byPlatform.get(p)
    if (account && isPlatform(p)) {
      plan.targets.push({
        platform: p,
        accountId: account.provider_account_id as string,
        options: kind ? { kind } : undefined,
      })
    } else {
      plan.missing.push(p)
    }
  }

  // the earliest time the scheduler set for this item, if any
  const { data: entries } = await supabase
    .from('schedule_entries')
    .select('scheduled_at')
    .eq('item_id', itemId)
    .not('scheduled_at', 'is', null)
    .order('scheduled_at', { ascending: true })
    .limit(1)
  plan.scheduledFor = (entries?.[0]?.scheduled_at as string) ?? null

  if (!plan.blocked && plan.targets.length === 0) {
    plan.blocked = wanted.length === 0
      ? 'This client has no connected accounts yet'
      : `No connected channel for ${plan.missing.join(', ')}`
  }

  return plan
}

/** Everything the posting card needs to know its own state, without a click. */
export type PostingContext = {
  /** is a provider configured at all */
  configured: boolean
  /** the client's live connected accounts */
  accounts: { platform: string; username: string | null; name: string | null }[]
  /** the item's most recent publish job, whatever became of it */
  job: {
    id: string
    status: string
    scheduled_for: string | null
    permalink: string | null
    error: string | null
    published_at: string | null
  } | null
  /** how the live post is doing — the same numbers the client's portal shows,
   *  so nobody has to open two screens to answer "how did it go" */
  metrics: PostItemMetrics | null
}

export type PostItemMetrics = PostMetrics & {
  sync_status: string | null
  synced_at: string
  post_url: string | null
  /** 'external' when these numbers came from matching a hand-posted link —
   *  the card says so, because "where did this figure come from" is a fair
   *  question about a post the app never published */
  source?: string | null
}

/**
 * Connected-accounts state, loaded WITH the item.
 *
 * The card used to need a "Check channels" click before it could say anything
 * — which meant the default state of the most consequential card on the page
 * was "I don't know". Two small indexed reads is a cheaper price than that.
 */
export async function loadPostingContext(
  itemId: string, clientId: string,
): Promise<PostingContext> {
  const [accountsRes, jobRes, analytics] = await Promise.all([
    supabase
      .from('social_accounts')
      .select('platform, username, name')
      .eq('client_id', clientId)
      .eq('active', true),
    supabase
      .from('publish_jobs')
      .select('id, status, scheduled_for, permalink, error, published_at')
      .eq('content_item_id', itemId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    analyticsForItems([itemId]),
  ])

  const a = analytics.get(itemId) ?? null

  return {
    configured: getPublisher().configured(),
    metrics: a
      ? {
        views: a.views, reach: a.reach, impressions: a.impressions, likes: a.likes,
        comments: a.comments, shares: a.shares, saves: a.saves,
        engagement_rate: a.engagement_rate,
        sync_status: a.sync_status, synced_at: a.synced_at, post_url: a.platform_post_url,
        source: a.source ?? null,
      }
      : null,
    accounts: (accountsRes.data ?? []).map(a => ({
      platform: String(a.platform).toLowerCase(),
      username: (a.username as string) ?? null,
      name: (a.name as string) ?? null,
    })),
    job: jobRes.data
      ? {
        id: jobRes.data.id as string,
        status: jobRes.data.status as string,
        scheduled_for: (jobRes.data.scheduled_for as string) ?? null,
        permalink: (jobRes.data.permalink as string) ?? null,
        error: (jobRes.data.error as string) ?? null,
        published_at: (jobRes.data.published_at as string) ?? null,
      }
      : null,
  }
}

/** Queue an approved item for publishing. Returns the job id and the plan it
 *  was built from — the caller needs the targets to record what was scheduled
 *  where, without planning the same item twice. */
export async function queueItemPublish(
  itemId: string,
  opts: { publishNow?: boolean; createdBy?: string } = {}
): Promise<{ id: string; plan: ItemPublishPlan } | { error: string; issues?: string[] }> {
  const plan = await planItemPublish(itemId)
  if (plan.blocked) return { error: plan.blocked }

  const queued = await queuePublishJob({
    clientId: plan.clientId,
    contentItemId: plan.itemId,
    caption: plan.caption,
    media: plan.media,
    targets: plan.targets,
    scheduledFor: opts.publishNow ? null : plan.scheduledFor,
    timezone: plan.timezone,
    createdBy: opts.createdBy,
  })
  if ('error' in queued) return queued
  return { id: queued.id, plan }
}

/**
 * Record what was just handed to the provider, per platform.
 *
 * The schedule row is the board's and the client portal's version of the same
 * fact — "Instagram, Thursday 6pm". Queueing without writing it left the item
 * queued at the provider and blank on every screen that reads schedule_entries,
 * which is most of them. `onConflict` keeps a human-set time rather than
 * stamping over it.
 */
async function recordQueuedSchedule(
  itemId: string, targets: Target[], scheduledFor: string | null,
): Promise<void> {
  if (targets.length === 0) return
  const when = scheduledFor ?? new Date().toISOString()
  const { data: existing } = await supabase
    .from('schedule_entries').select('platform, scheduled_at').eq('item_id', itemId)
  const has = new Map((existing ?? []).map(r => [String(r.platform), r.scheduled_at]))

  const rows = targets
    // a platform that already carries a time keeps it — the queue used that
    // same time, so rewriting it would only churn the row
    .filter(t => !has.get(t.platform))
    .map(t => ({ item_id: itemId, platform: t.platform, scheduled_at: when }))
  if (rows.length === 0) return
  const { error } = await supabase
    .from('schedule_entries').upsert(rows, { onConflict: 'item_id,platform' })
  if (error) console.error('could not record the queued schedule', itemId, error.message)
}

/**
 * Queueing IS scheduling — so the status says so, in the same request.
 *
 * The owner queued a post and then had to press "Mark scheduled" by hand;
 * forgetting meant the board said "Approved" about something already sitting
 * in Instagram's scheduler. The person who queued it holds the scheduling hat
 * by definition (the endpoint is scheduler-gated), so the move is theirs and it
 * is logged as theirs.
 *
 * Idempotent: an item already past "Approved" returns null and moves nothing.
 * Best-effort: a failed status change must never make a queued post look
 * un-queued — the post is real either way.
 */
export async function markScheduledAfterQueue(
  actor: TeamUser,
  item: ContentItem,
  plan: ItemPublishPlan,
  publishNow: boolean,
): Promise<ItemStatus | null> {
  await recordQueuedSchedule(item.id, plan.targets, publishNow ? null : plan.scheduledFor)

  const next = statusAfterQueue(item.status)
  if (!next) return null
  try {
    const updated = await performTransition(actor, item, next, {
      grantedHats: ['scheduler'],
      // the publish route has already emailed the client's managers — the ones
      // the scheduler picked — saying this is scheduled. The item's owner still
      // hears it from here: nobody else tells the editor their piece is booked.
      skipAudiences: ['account_managers'],
    })
    return updated.status
  } catch (e) {
    // 409 = somebody else moved it first, which is the outcome we wanted
    console.error('could not mark the item scheduled after queueing', item.id, e)
    return null
  }
}

/**
 * Write a publish result back into production.
 *
 * Without this the two halves drift: the post is live on Instagram while the
 * board still says "scheduled", and the scheduler has no live link to give the
 * client. Best-effort by design — a bookkeeping failure must never make a
 * successful publish look failed.
 */
export async function recordPublishOnItem(
  contentItemId: string,
  permalink: string | null,
  platforms: string[] = [],
): Promise<void> {
  try {
    const patch: Record<string, unknown> = {
      publish_status: 'published',
      published_at: new Date().toISOString(),
    }
    if (permalink) patch.live_url = permalink

    await supabase.from('schedule_entries').update(patch).eq('item_id', contentItemId)

    // The status change runs through the ordinary machine, wearing a system
    // actor: the same optimistic-concurrency guard, the same workflow_activity
    // row, the same notifications the team gets for every other move. The old
    // code wrote content_items.status directly and hand-rolled the log entry,
    // which meant "it went live" was the one transition that skipped every
    // guarantee the rest of the workflow has.
    const { data: row } = await supabase
      .from('content_items')
      .select('id, client_id, batch_id, title, content_type, status, owner_id, caption, client_approval_required, current_version_number, scheduler_ids')
      .eq('id', contentItemId)
      .maybeSingle()
    if (!row) return

    const actor = systemActor(systemActorLabel(platforms))
    let item = row as unknown as ContentItem
    for (const to of systemPublishSteps(item.status)) {
      item = await performTransition(actor, item, to)
    }
    // open boards must hear about it, not wait for the 60s poll
    announceItemChange({
      item_id: contentItemId, client_id: item.client_id, status: item.status, kind: 'transition',
    })
  } catch (e) {
    console.error('could not record publish on content item', contentItemId, e)
  }
}
