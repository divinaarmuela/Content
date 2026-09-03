import 'server-only'
import { announceItemChange } from './production-live'
import { table } from '@/lib/db'
import type {
  AssetVersion, Client, ContentItem as ContentItemRow, PublishJob, ScheduleEntry, SocialAccount,
} from '@/lib/db-types'
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
  const item = await table<ContentItemRow>('content_items').get(itemId)

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
  const client = await table<Client>('clients').get(item.client_id)
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
  const version = (await table<AssetVersion>('asset_versions')
    .list({ by: { item_id: itemId }, orderBy: [['version_number', 'desc']], limit: 1 }))[0] ?? null

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
  const accounts = await table<SocialAccount>('social_accounts')
    .list({ by: { client_id: item.client_id }, where: a => a.active === true })

  // no explicit targets (the common case — nothing in the UI set them) means
  // every connected channel, rather than a permanently dead publish button
  let wanted = ((item.platform_targets as unknown as string[]) ?? []).map(p => p.toLowerCase())
  if (wanted.length === 0) {
    wanted = [...new Set(accounts.map(a => (a.platform as string).toLowerCase()))]
  }

  // production already knows what kind of content this is — carry it through
  // so a Reel is published as a Reel rather than a plain video post
  const kind = contentTypeToKind(item.content_type as string, plan.media)

  const byPlatform = new Map(accounts.map(a => [a.platform as string, a]))
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
  const entries = await table<ScheduleEntry>('schedule_entries').list({
    by: { item_id: itemId },
    where: r => r.scheduled_at != null,
    orderBy: [['scheduled_at', 'asc']],
    limit: 1,
  })
  plan.scheduledFor = (entries[0]?.scheduled_at as string) ?? null

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
  const [accounts, jobs, analytics] = await Promise.all([
    table<SocialAccount>('social_accounts')
      .list({ by: { client_id: clientId }, where: a => a.active === true }),
    table<PublishJob>('publish_jobs').list({
      where: j => j.content_item_id === itemId,
      orderBy: [['created_at', 'desc']],
      limit: 1,
    }),
    analyticsForItems([itemId]),
  ])
  const job = jobs[0] ?? null

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
    accounts: accounts.map(a => ({
      platform: String(a.platform).toLowerCase(),
      username: (a.username as string) ?? null,
      name: (a.name as string) ?? null,
    })),
    job: job
      ? {
        id: job.id,
        status: job.status,
        scheduled_for: job.scheduled_for ?? null,
        permalink: job.permalink ?? null,
        error: job.error ?? null,
        published_at: job.published_at ?? null,
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
 * which is most of them. A human-set time is kept rather than stamped over.
 */
async function recordQueuedSchedule(
  itemId: string, targets: Target[], scheduledFor: string | null,
): Promise<void> {
  if (targets.length === 0) return
  const when = scheduledFor ?? new Date().toISOString()
  const existing = await table<ScheduleEntry>('schedule_entries').list({ by: { item_id: itemId } })
  const byPlatform = new Map(existing.map(r => [String(r.platform), r]))

  const rows = targets
    // a platform that already carries a time keeps it — the queue used that
    // same time, so rewriting it would only churn the row
    .filter(t => !byPlatform.get(t.platform)?.scheduled_at)
    .map(t => ({ item_id: itemId, platform: t.platform, scheduled_at: when }))
  if (rows.length === 0) return
  try {
    for (const row of rows) {
      const current = byPlatform.get(row.platform)
      if (current) await table('schedule_entries').update(current.id, row)
      else await table('schedule_entries').insert({ publish_status: 'scheduled', ...row })
    }
  } catch (e) {
    console.error('could not record the queued schedule', itemId, e instanceof Error ? e.message : e)
  }
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

    const entries = await table<ScheduleEntry>('schedule_entries')
      .list({ by: { item_id: contentItemId } })
    await Promise.all(entries.map(e => table('schedule_entries').update(e.id, patch)))

    // The status change runs through the ordinary machine, wearing a system
    // actor: the same optimistic-concurrency guard, the same workflow_activity
    // row, the same notifications the team gets for every other move. The old
    // code wrote content_items.status directly and hand-rolled the log entry,
    // which meant "it went live" was the one transition that skipped every
    // guarantee the rest of the workflow has.
    const row = await table<ContentItemRow>('content_items').get(contentItemId)
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
