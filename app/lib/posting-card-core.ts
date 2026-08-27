/**
 * The posting card's state machine — pure, no I/O, fully unit-tested.
 *
 * One card, one state, one action. Before this, the scheduling card offered
 * "Set date", "Publish now", "Queue for …", "Mark as posted" and two
 * top-of-page workflow buttons all at once, and the operator had to know which
 * combination meant "this will actually go out". The decision is not theirs to
 * make: schedulers post FROM THE APP, so the card asks one question — is this
 * client connected? — and shows exactly the one thing to do next.
 *
 * Nothing here touches the database or the provider. The server derives the
 * same states from the same facts; this module is what both agree on.
 */
import type { ItemStatus } from './workflow-core'

/** publish_jobs.status, as the database constrains it. */
export type PostingJobStatus =
  | 'queued' | 'publishing' | 'scheduled' | 'published' | 'duplicate' | 'failed' | 'cancelled'

/** The item's live publish job, as much of it as the card needs. */
export type PostingJob = {
  id: string
  status: PostingJobStatus
  scheduled_for: string | null
  permalink: string | null
  error: string | null
  published_at?: string | null
}

/** One row of schedule_entries — a platform, its time, and whether it is out. */
export type PostingEntry = {
  platform: string
  scheduled_at: string | null
  live_url: string | null
  publish_status: string | null
  published_at?: string | null
  /**
   * For a post published BY HAND: did we manage to find it on the platform?
   * 'matched' — its numbers are cached. 'not_found' — we looked and the link
   * matched nothing, which is worth telling the scheduler. Absent means no
   * lookup has happened, and the card says nothing rather than accusing a
   * perfectly good link during the seconds before the first attempt lands.
   */
  external_match_state?: string | null
}

export type PostingInput = {
  /** platforms this client has an ACTIVE connected account for */
  connected: string[]
  /** the platform this item is aimed at */
  platform: string
  entries: PostingEntry[]
  job: PostingJob | null
  /** is a publishing provider configured at all (ZERNIO_API_KEY present)? */
  configured: boolean
  /** for "is the chosen time in the past?" — injected so tests are not clocks */
  now?: number
}

export type PostingState =
  /** no provider at all: nothing on this card can work, and saying so beats
   *  a Connect button that 503s */
  | { kind: 'not_configured'; platform: string }
  /** the client has never connected this platform */
  | { kind: 'not_connected'; platform: string }
  /** connected, nothing queued — the one primary action lives here */
  | { kind: 'ready'; platform: string; when: string | null; past: boolean }
  /** handed over: ours (queued) or the provider's (scheduled) */
  | { kind: 'queued'; platform: string; when: string | null; jobId: string; handedOver: boolean }
  /** it is out. `manual` means a human recorded it, not the provider */
  | { kind: 'posted'; platform: string; permalink: string | null; at: string | null; manual: boolean }
  /** the provider refused or the post never landed */
  | { kind: 'failed'; platform: string; error: string; jobId: string }

/** Platform names as people say them, not as the database stores them. */
const PLATFORM_LABELS: Record<string, string> = {
  instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok',
  linkedin: 'LinkedIn', youtube: 'YouTube', threads: 'Threads',
  pinterest: 'Pinterest', twitter: 'X', x: 'X',
}

export function platformLabel(platform: string): string {
  const p = (platform ?? '').toLowerCase()
  return PLATFORM_LABELS[p] ?? (p ? p.charAt(0).toUpperCase() + p.slice(1) : 'the channel')
}

/**
 * Which platform this card is about.
 *
 * The item's own targets win; failing that, whatever the client actually has
 * connected — an item with no explicit target still has one obvious channel
 * when the client only ever posts to one. Instagram is the last resort so the
 * card can still name something rather than say "the platform".
 */
export function choosePlatform(targets: string[], connected: string[]): string {
  const t = (targets ?? []).map(s => String(s).toLowerCase()).filter(Boolean)
  // a target the client HAS is better than a target they do not
  const live = t.find(p => connected.includes(p))
  if (live) return live
  if (t.length > 0) return t[0]
  return connected[0] ?? 'instagram'
}

/** A job that is still going somewhere. */
const LIVE_JOB: PostingJobStatus[] = ['queued', 'publishing', 'scheduled']
/** A job the provider has accepted as done. */
const DONE_JOB: PostingJobStatus[] = ['published', 'duplicate']

/**
 * The card's single state.
 *
 * Precedence is deliberate and it is not the order the fields appear in:
 *   posted → failed → queued → configuration → connection → ready.
 * A post that is already live outranks everything (there is nothing to decide);
 * a failure outranks a queue (the queue is what failed); and a disconnected
 * account only matters when nothing is in flight — telling someone to connect
 * an account while their post is out would be nonsense.
 */
export function derivePostingState(input: PostingInput): PostingState {
  const platform = (input.platform || '').toLowerCase()
  const job = input.job
  const entries = input.entries ?? []
  const entry = entries.find(e => (e.platform ?? '').toLowerCase() === platform) ?? null
  const postedEntry = entries.find(e => e.publish_status === 'published') ?? null

  if (job && DONE_JOB.includes(job.status)) {
    return {
      kind: 'posted', platform,
      permalink: job.permalink ?? postedEntry?.live_url ?? null,
      at: job.published_at ?? postedEntry?.published_at ?? null,
      manual: false,
    }
  }
  // recorded by a human — a Story posted in the app, or a link pasted in
  if (postedEntry && (!job || !LIVE_JOB.includes(job.status))) {
    return {
      kind: 'posted', platform,
      permalink: postedEntry.live_url ?? null,
      at: postedEntry.published_at ?? null,
      manual: true,
    }
  }
  if (job && job.status === 'failed') {
    return {
      kind: 'failed', platform, jobId: job.id,
      error: job.error?.trim() || 'The channel refused the post and did not say why.',
    }
  }
  if (job && LIVE_JOB.includes(job.status)) {
    return {
      kind: 'queued', platform, jobId: job.id,
      when: job.scheduled_for ?? entry?.scheduled_at ?? null,
      // 'scheduled' means the provider is holding it; 'queued' means we are
      handedOver: job.status === 'scheduled',
    }
  }
  if (!input.configured) return { kind: 'not_configured', platform }
  if (!input.connected.map(p => p.toLowerCase()).includes(platform)) {
    return { kind: 'not_connected', platform }
  }

  const when = entry?.scheduled_at ?? null
  const now = input.now ?? Date.now()
  return {
    kind: 'ready', platform, when,
    // a time already gone is not a schedule, it is "post it now"
    past: when ? new Date(when).getTime() <= now : true,
  }
}

/** The primary button's words for a state, already carrying the platform. */
export function postingPrimaryLabel(state: PostingState): string | null {
  switch (state.kind) {
    case 'ready':
      return state.past ? `Post now on ${platformLabel(state.platform)}`
        : `Schedule on ${platformLabel(state.platform)}`
    case 'not_connected': return 'Send the client a connect link'
    case 'failed': return 'Retry'
    default: return null
  }
}

/**
 * Queueing a post IS scheduling it.
 *
 * The owner had to press "Mark scheduled" by hand after queuing, which meant
 * the board could disagree with reality for as long as nobody remembered. The
 * act of handing a post to the provider is the act the status describes, so
 * the same request performs it. Anything already past this point is left
 * alone — this is idempotent by returning null, not by moving twice.
 */
export function statusAfterQueue(status: ItemStatus): ItemStatus | null {
  return status === 'approved_for_scheduling' ? 'scheduled' : null
}

/**
 * The steps a SYSTEM actor walks when the provider confirms a post is live.
 *
 * Normally one step: scheduled → published. An item that was queued while the
 * queue-time transition failed is still at "Approved", and refusing to record
 * a post that is demonstrably live would leave the board lying — so it walks
 * the edge it skipped first. Never more than these two edges.
 */
export function systemPublishSteps(status: ItemStatus): ItemStatus[] {
  if (status === 'scheduled') return ['published']
  if (status === 'approved_for_scheduling') return ['scheduled', 'published']
  return []
}

/** The only edges a system actor may ever perform. Nothing else is automatic. */
export const SYSTEM_EDGES: ReadonlySet<string> = new Set([
  'approved_for_scheduling>scheduled',
  'scheduled>published',
])

export function systemMayMove(from: ItemStatus, to: ItemStatus): boolean {
  return SYSTEM_EDGES.has(`${from}>${to}`)
}

/** "Posted by Instagram" — who the audit trail credits when nobody clicked. */
export function systemActorLabel(platforms: string[]): string {
  const names = [...new Set((platforms ?? []).map(p => platformLabel(p)).filter(Boolean))]
  if (names.length === 0) return 'Posted by the connected account'
  return `Posted by ${names.slice(0, 3).join(' & ')}`
}
