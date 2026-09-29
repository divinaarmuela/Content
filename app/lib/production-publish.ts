import 'server-only'
import { announceItemChange } from './production-live'
import { table } from '@/lib/db'
import type {
  AssetVersion, Client, ContentItem as ContentItemRow, PublishJob, ScheduleEntry, SocialAccount, SocialPost,
} from '@/lib/db-types'
import { queuePublishJob } from './publish'
import { getPublisher } from './publisher'
import {
  BOOK_FROM_THE_POST, isPlatform, mediaTypeFor,
  type MediaItem, type PostKind, type Target,
} from './publish-core'
import { postSlides, slidesOf } from './version-files-core'
import { approvedFilesVersion } from './social-schedule-core'
import { DEFAULT_TZ, safeZone } from './timezone-core'
import { STATUS_LABELS, type ItemStatus } from './workflow-core'
import { performTransition, systemActor, type ContentItem } from './workflow'
import { statusAfterQueue, systemActorLabel, systemPublishSteps } from './posting-card-core'
import { fullyPosted, postedProgress, publishedSlideUrls, readPostedSlides } from './posted-slides-core'
import {
  bookingJobs, jobIdsOfPost, postNetworkOutcomes, sameOutcomes, scheduleRowWrites, unlinkedJobs, urlBelongsTo,
  type BookingJob, type ScheduleRowWrite,
} from './post-outcome-core'
import {
  outcomeAction, readPostState,
  type NetworkOutcome, type PostState, type TransitionInput,
} from './post-stage-core'
import { analyticsForItems } from './post-analytics'
import type { PostMetrics } from './post-analytics-core'
import { readPerformance, type PostPerformance } from './post-performance-core'
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
    // one file out of a carousel piece is a single post, not a one-slide
    // carousel (posted in parts, 9 Sep 2026)
    case 'carousel': return media.length > 1 ? 'carousel' : (media[0]?.type === 'video' ? 'reel' : 'feed')
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

  // …and an ITEM is not a post. What goes out is a post, approved as a post
  // (passed at quality check, or approved by or for the client) and booked
  // from Schedule, where its own stage is checked (the posting rebuild, 29 Sep
  // 2026). The item-wide gate that used to stand here is gone, so this door is
  // shut rather than left open with no gate at all.
  if (!plan.blocked) plan.blocked = BOOK_FROM_THE_POST

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
  /** the "How it did" summary the card draws; null until the sweep has run */
  performance?: PostPerformance | null
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
        performance: readPerformance(a.performance),
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
 * which is most of them.
 *
 * The row takes THIS booking's time. It used to keep whatever time a row
 * already had, on the belief that the queue had used the same one — but a
 * re-booked post had not: row 48f70493 kept the time of cancelled job
 * 41ee4e5d while the post went out an hour later (audit L8). A network
 * already posted keeps its row as it is.
 */
async function recordQueuedSchedule(
  itemId: string, targets: Target[], scheduledFor: string | null,
): Promise<void> {
  if (targets.length === 0) return
  const when = scheduledFor ?? new Date().toISOString()
  const existing = await table<ScheduleEntry>('schedule_entries').list({ by: { item_id: itemId } })
  const byPlatform = new Map(existing.map(r => [String(r.platform), r]))

  const rows = targets
    .filter(t => {
      const row = byPlatform.get(t.platform)
      return !row || (row.publish_status !== 'published' && row.scheduled_at !== when)
    })
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
 *
 * The plan is narrowed to the two things this needs — what was sent where, and
 * when — so the OTHER path that hands a post to the provider (the composer's
 * "book it in", which plans its own targets) records the same fact through
 * this same function instead of growing a second copy of it.
 */
export async function markScheduledAfterQueue(
  actor: TeamUser,
  item: ContentItem,
  plan: Pick<ItemPublishPlan, 'targets' | 'scheduledFor'>,
  publishNow: boolean,
  opts: { moveItem?: boolean } = {},
): Promise<ItemStatus | null> {
  await recordQueuedSchedule(item.id, plan.targets, publishNow ? null : plan.scheduledFor)

  // a piece posted in parts is not "booked in" until every file is (9 Sep 2026)
  if (opts.moveItem === false) return null
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

/* ── THE PUBLISH RECORDER (the posting rebuild, 29 Sep 2026) ────────────────
 *
 * What went out, per network, written onto the POST — SPEC §5 and package P2.
 *
 * Every place a job settles calls `recordPostOutcome(jobId)`: the publish run,
 * the ten-minute reconcile, the provider's webhook, the analytics back-fill.
 * It reads the jobs of the booking (its re-sends included), works out each
 * network's outcome (post-outcome-core.postNetworkOutcomes), and asks the ONE
 * writer of a post's stage — P1's `performSystemTransition` (post-stage.ts),
 * wearing the system hat — for the matching row:
 *
 *   T16 record_posted   every network went out           booked → posted
 *   T17 record_partial  some out, some not               booked → posted, with a problem naming the network
 *   T18 record_failed   none went out (or the job lost)  booked → ready, with the problem
 *
 * It never writes `stage` itself (SPEC §8.3: the only writer is post-stage.ts).
 * It is the only writer of `outcomes`, through those rows. And it writes each
 * network's schedule row with that network's own link, never one link on all
 * (audit V16, L1, L2).
 *
 * Idempotent: a sweep that learns nothing new writes nothing; a lost race
 * (another write between our read and the writer's claim) is read again.
 * Best effort: a bookkeeping failure never makes a publish look failed.
 */

export type RecorderAction = 'record_posted' | 'record_partial' | 'record_failed' | 'link_jobs'

/** What the one writer answers: the post as it now stands, or why not. */
export type StageWriteResult =
  | { ok: true; post: PostState }
  | { ok: false; code?: string | null; reason: string; post?: PostState | null }

/**
 * The one writer of a post's stage, narrowed to the system rows —
 * `performSystemTransition(postId, action, input)` in app/lib/post-stage.ts
 * (package P1), which runs the rules again inside its claim, on the row it
 * lands on. Handed in so the tests can stand in for it.
 */
export type StageWriter = (postId: string, action: RecorderAction, input: TransitionInput) => Promise<StageWriteResult>

/** P1's writer, lazily loaded (post-stage.ts loads this file lazily too). */
async function stageWriter(): Promise<StageWriter> {
  const { performSystemTransition } = await import('./post-stage')
  return async (postId, action, input) => {
    try {
      const r = await performSystemTransition(postId, action, input)
      return r.ok ? { ok: true, post: r.post } : { ok: false, code: r.code, reason: r.reason, post: r.post }
    } catch (e) {
      return { ok: false, code: null, reason: e instanceof Error ? e.message : String(e), post: null }
    }
  }
}

export type RecordedPost = {
  post_id: string
  /** the row asked for, or null while a network is still going out */
  action: RecorderAction | null
  wrote: boolean
  /** where the post stands after this */
  stage: string | null
  note?: string
}
export type RecordOutcomeResult = { job_id: string; posts: RecordedPost[]; schedule_rows: number }

const postsTable = () => table<SocialPost>('social_posts')

/** Every post that holds this job, or the job it re-sends. */
async function postsHolding(job: PublishJob): Promise<SocialPost[]> {
  const ids = new Set([job.id, ...(job.resend_of ? [job.resend_of] : [])])
  const rows = job.content_item_id
    ? await postsTable().list({ by: { item_id: job.content_item_id } })
    : job.client_id ? await postsTable().list({ by: { client_id: job.client_id } }) : []
  return rows.filter(r => jobIdsOfPost(r as never).some(id => ids.has(id)))
}

/** The jobs a booking may hold: the job's own item's (or client's), re-sends included. */
async function jobsAround(job: PublishJob): Promise<BookingJob[]> {
  const rows = job.content_item_id
    ? await table<PublishJob>('publish_jobs').list({ by: { content_item_id: job.content_item_id } })
    : job.client_id ? await table<PublishJob>('publish_jobs').list({ by: { client_id: job.client_id } }) : [job]
  return rows as unknown as BookingJob[]
}

/**
 * Record what one job came to, on every post that holds it.
 *
 * `lost`: the provider cancelled this job itself (its webhook), so its
 * networks did not go out — T18 "the job was lost". A cancel of our own
 * marks the job cancelled on our side, so the provider's echo finds no open
 * job and is not called lost — except in the moment between P1 asking the
 * provider and writing our row (post-stage.defaultCancelJob), where the move
 * P1 is making then meets a changed post and is refused, never applied twice.
 */
export async function recordPostOutcome(
  jobId: string,
  opts: { lost?: boolean; write?: StageWriter } = {},
): Promise<RecordOutcomeResult> {
  const result: RecordOutcomeResult = { job_id: jobId, posts: [], schedule_rows: 0 }
  try {
    const job = await table<PublishJob>('publish_jobs').get(jobId, { fresh: true })
    if (!job) return result
    const holders = await postsHolding(job)
    const staged = holders.filter(r => readPostState(r as never) !== null)
    const all = await jobsAround(job)
    const lost = opts.lost ? new Set([job.id]) : new Set<string>()

    if (staged.length === 0) {
      // A post the migration has not reached yet (no stage): nothing to move,
      // but its schedule rows and the edit card still hear what went out, per
      // network — the old recorder's job, without its one-link-on-every-row bug.
      if (job.content_item_id) {
        const own = bookingJobs([job.resend_of ?? job.id], all)
        const { outcomes } = postNetworkOutcomes(own, { lost })
        result.schedule_rows += await writeScheduleRows(job.content_item_id, outcomes, job.scheduled_for ?? null)
        const live = Object.entries(outcomes).filter(([, o]) => o.status === 'published' || o.status === 'duplicate').map(([p]) => p)
        if (live.length > 0) await rollUpItem(job.content_item_id, live)
      }
      return result
    }

    const write = opts.write ?? await stageWriter()
    for (const row of staged) {
      const done = await recordOnPost(row.id, all, lost, write)
      result.posts.push(done.recorded)
      if (done.itemId && done.outcomes) {
        result.schedule_rows += await writeScheduleRows(done.itemId, done.outcomes, done.bookedFor)
        if (done.recorded.wrote && (done.recorded.action === 'record_posted' || done.recorded.action === 'record_partial')) {
          await rollUpItem(done.itemId, done.live)
        }
      }
    }
  } catch (e) {
    console.error('[publish recorder] could not record job', jobId, e instanceof Error ? e.message : e)
  }
  return result
}

/** One post: link its re-sends, work out its networks, ask for the row. A stale read is read again. */
async function recordOnPost(
  postId: string,
  all: readonly BookingJob[],
  lost: ReadonlySet<string>,
  write: StageWriter,
): Promise<{
  recorded: RecordedPost
  itemId: string | null
  outcomes: Record<string, NetworkOutcome> | null
  bookedFor: string | null
  live: string[]
}> {
  const none = (note: string, stage: string | null = null) => ({
    recorded: { post_id: postId, action: null, wrote: false, stage, note },
    itemId: null, outcomes: null, bookedFor: null, live: [] as string[],
  })
  for (let attempt = 0; attempt < 4; attempt++) {
    const raw = await postsTable().get(postId, { fresh: true })
    const post = readPostState(raw as never)
    if (!raw || !post) return none('no stage yet')
    const held = jobIdsOfPost(raw as never)
    const mine = bookingJobs(held, all)
    const { outcomes, platforms } = postNetworkOutcomes(mine, { lost })
    const itemId = post.source_item_id
    const bookedFor = post.booking?.for_time ?? post.scheduled_for
    const live = Object.entries(outcomes).filter(([, o]) => o.status === 'published' || o.status === 'duplicate').map(([p]) => p)
    const answer = (recorded: RecordedPost) => ({ recorded, itemId, outcomes, bookedFor, live })

    // only a booking reports back; a post taken off the schedule, cancelled or
    // edited has left it, and its rows are not ours to touch
    if (post.stage !== 'booked' && post.stage !== 'posted') {
      return { ...none(`in ${post.stage}`, post.stage) }
    }

    // a re-send the booking does not list yet is linked first, so a cancel
    // sees it too (audit V11)
    const unlinked = unlinkedJobs(held, all)
    if (unlinked.length > 0) {
      const linked = await write(post.id, 'link_jobs', { job_ids: unlinked })
      if (linked.ok || linked.code === 'stale') continue
      console.error('[publish recorder] could not link the re-sends of post', post.id, linked.reason)
    }

    const merged = { ...post.outcomes, ...outcomes }
    const action = outcomeAction(merged, platforms)
    if (!action) return answer({ post_id: post.id, action: null, wrote: false, stage: post.stage, note: 'still going out' })
    if (post.stage === 'posted') {
      // a posted post only learns more (a link, a re-send that went out) —
      // it never goes back, and the same news twice writes nothing
      if (action === 'record_failed' || sameOutcomes(merged, post.outcomes)) {
        return answer({ post_id: post.id, action, wrote: false, stage: post.stage, note: 'nothing new' })
      }
    }
    const res = await write(post.id, action, { outcomes, platforms })
    if (res.ok) return answer({ post_id: post.id, action, wrote: true, stage: res.post.stage })
    if (res.code === 'stale') continue
    return answer({ post_id: post.id, action, wrote: false, stage: post.stage, note: res.reason })
  }
  return none('kept changing while being recorded — the next sweep tries again')
}

/** Each network's own schedule row, with its own link (audit V16, L1, L2, L8). */
async function writeScheduleRows(
  itemId: string, outcomes: Record<string, NetworkOutcome>, bookedFor: string | null,
): Promise<number> {
  if (Object.keys(outcomes).length === 0) return 0
  try {
    const entries = table<ScheduleEntry>('schedule_entries')
    const rows = await entries.list({ by: { item_id: itemId } })
    const writes: ScheduleRowWrite[] = scheduleRowWrites(itemId, outcomes, rows, bookedFor)
    for (const w of writes) {
      if (w.kind === 'update') await entries.update(w.id, w.patch as Partial<ScheduleEntry>)
      else await table('schedule_entries').insert(w.row)
    }
    return writes.length
  } catch (e) {
    console.error('[publish recorder] could not write the schedule rows of', itemId, e instanceof Error ? e.message : e)
    return 0
  }
}

/**
 * The backstop, run by the ten-minute publish dispatcher (no new Inngest
 * function, so nothing to re-sync — CLAUDE.md trap 5b). Every post still
 * booked is recorded again from its jobs, so a webhook that never came, or a
 * job that settled before its booking was written down, still reaches the
 * post. Returns how many posts moved.
 */
export async function recordBookedOutcomes(opts: { write?: StageWriter; limit?: number } = {}): Promise<number> {
  const booked = await postsTable().list({ where: p => p.stage === 'booked', limit: opts.limit ?? 100 })
  let moved = 0
  for (const p of booked) {
    const jobIds = jobIdsOfPost(p as never)
    if (jobIds.length === 0) continue
    const r = await recordPostOutcome(jobIds[0], opts)
    if (r.posts.some(x => x.post_id === p.id && x.wrote)) moved++
  }
  return moved
}

/**
 * Write a publish result back into production — the edit card and its
 * schedule rows — for a file posted BY HAND (the card's "Posted by hand").
 *
 * Only the named networks' rows are touched, and a link only lands on the
 * network it belongs to: this used to set every row of the card to published
 * with one permalink, so a LinkedIn row carried a TikTok link and an Instagram
 * row that never posted read published (audit V16, L1, L2). A post booked
 * through the app is recorded by `recordPostOutcome` instead.
 */
export async function recordPublishOnItem(
  contentItemId: string,
  permalink: string | null,
  platforms: string[] = [],
): Promise<void> {
  try {
    const named = [...new Set(platforms.map(p => String(p).toLowerCase()).filter(Boolean))]
    if (named.length > 0) {
      const now = new Date().toISOString()
      const outcomes: Record<string, NetworkOutcome> = {}
      for (const p of named) {
        outcomes[p] = {
          status: 'published',
          url: urlBelongsTo(p, permalink, named.length === 1) ? permalink : null,
          at: now,
          error: null,
        }
      }
      await writeScheduleRows(contentItemId, outcomes, null)
    }
    await rollUpItem(contentItemId, named)
  } catch (e) {
    console.error('could not record publish on content item', contentItemId, e)
  }
}

/**
 * The edit card's roll-up (SPEC §2.5): its "posted" count, and Published once
 * every file has gone. It reads the posts; it never moves one.
 */
async function rollUpItem(contentItemId: string, platforms: string[]): Promise<void> {
  try {
    // The status change runs through the ordinary machine, wearing a system
    // actor: the same optimistic-concurrency guard, the same workflow_activity
    // row, the same notifications the team gets for every other move.
    const row = await table<ContentItemRow>('content_items').get(contentItemId)
    if (!row) return

    /**
     * A PIECE POSTED IN PARTS (9 Sep 2026). The card's files against every
     * post made from it: the ones a published job carried, plus the ones
     * marked posted by hand (kept on the row). The card moves to Posted only
     * when every file has gone; until then it stays where it is, saying
     * "2 of 4 posted", and the Schedule page offers only the rest.
     */
    const progress = await postedSlidesFor(contentItemId, row as { posted_slides?: unknown })
    await table('content_items').update(contentItemId, { posted_slides: progress })
    if (progress.total > 0 && !fullyPosted(progress)) {
      announceItemChange({
        item_id: contentItemId, client_id: (row as { client_id: string }).client_id, status: String(row.status), kind: 'updated',
      })
      return
    }

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
    console.error('could not roll the publish up onto content item', contentItemId, e)
  }
}

/** what has gone out of this piece, read from its posts and their jobs and
 *  the files marked posted by hand */
export async function postedSlidesFor(
  contentItemId: string,
  row: { posted_slides?: unknown },
): Promise<{ urls: string[]; posted: number; total: number }> {
  const [versions, socialPosts, jobs] = await Promise.all([
    table<AssetVersion>('asset_versions').list({ by: { item_id: contentItemId } }),
    table<SocialPost>('social_posts').list({ by: { item_id: contentItemId } }).catch(() => [] as SocialPost[]),
    table<PublishJob>('publish_jobs').list({ by: { content_item_id: contentItemId } }).catch(() => [] as PublishJob[]),
  ])
  // a files card counts its APPROVED FILES, the same as the Schedule offers them (24 Sep 2026)
  const item = await table<ContentItemRow>('content_items').get(contentItemId).catch(() => null)
  const latest = (item ? approvedFilesVersion(item as never) : null) ?? [...versions].sort((a, b) => Number(b.version_number ?? 0) - Number(a.version_number ?? 0))[0] ?? null
  const slides = slidesOf(latest as never)
  // 'duplicate' is out too: the provider refused a second copy because the first is live (audit S5)
  const publishedJobs = new Set(jobs.filter(j => ['published', 'duplicate'].includes(String(j.status))).map(j => j.id))
  const prev = readPostedSlides(row.posted_slides)
  // a post's jobs are its booking's now (SPEC §2.1), the legacy list only before migration
  const posts = socialPosts.map(p => ({ ...p, publish_job_ids: jobIdsOfPost(p as never) }))
  return postedProgress(slides, publishedSlideUrls(posts, publishedJobs), prev?.urls ?? [], prev?.hand)
}
