/**
 * WHAT THE SCHEDULE PAGE SHOWS — pure, no I/O, no `server-only`.
 *
 * The posting rebuild, package P4 (29 Sep 2026). Read
 * docs/posting-rebuild/OWNER_DECISIONS.md decision 1 first: Schedule gets
 * APPROVED posts out. It shows Ready to post, Booked in, Posted, and the times
 * that were missed. It never approves anything and never shows a post that is
 * still being approved — that is the Post approval page's job.
 *
 * Every word and every colour here comes from the one list in
 * `post-stage-core` (STAGE_WORDS, MISSED_LABEL, postedWords, waitingOn). This
 * file only decides which of those words a tile wears, and it reads nothing
 * but the post's own `stage` and records. It never reads the edit card, the
 * publish job or the old `status` column — that mix-up is what drew a draft as
 * "Approved" (audit S2) and a live post as not posted (audit S5).
 *
 * Why its own file and not `social-schedule-core`: `post-stage-core` imports
 * the composition rule from `social-schedule-core`, so putting this there
 * would make the two import each other.
 */

import {
  MISSED_LABEL, MISSED_TONE, STAGE_LABEL, STAGE_TONE, SCHEDULE_LANES,
  failedNetworks, liveNetworks, lostChannels, postActions, postedWords, slotMissed, waitingOn,
  type AccountRef, type NowLike, type OfferedAction, type PostHat, type PostStage, type PostState, type StageTone,
} from './post-stage-core'
import { networkName } from './publish-core'

/* ── which posts this page shows ────────────────────────────────────────── */

/** The stages the calendar draws: Ready to post, Booked in, Posted (decision 1). */
export const SCHEDULE_STAGES: readonly PostStage[] = SCHEDULE_LANES.flatMap(l => l.stages)

/** Is this a stage the week, the month, the preview and the stories draw? */
export function showsOnSchedule(stage: PostStage): boolean {
  return SCHEDULE_STAGES.includes(stage)
}

/** Still on the approval road — shown on Post approval, only counted here. */
export const BEING_APPROVED: readonly PostStage[] = ['draft', 'quality_check', 'with_client']

/* ── what one tile says ─────────────────────────────────────────────────── */

export type NetworkLine = {
  platform: string
  /** "Instagram" */
  network: string
  /** "Went out", "Did not go out", "Booked in", "No answer yet" */
  label: string
  tone: 'done' | 'trouble' | 'waiting'
  /** the live link on that network, when it gave one */
  url: string | null
  /** why it did not go out, in the network's words */
  error: string | null
}

export type ScheduleFacts = {
  stage: PostStage
  /** the chip: "Ready to post", "Missed — needs a new time", "Posted on 1 of 2 — …" */
  label: string
  /** the colour the tile and the chip wear */
  tone: StageTone
  /** the posting time has gone while the post waited (decision 11) */
  missed: boolean
  /** the one line under the title: who it waits on, or what happened */
  line: string
  /**
   * Something that stops it going out, said out loud: a channel that is not
   * connected, or why it came back from the schedule. Drawn as a red "!" on
   * the tile and as text in the List — never only in a hover title (audit S13).
   */
  alert: string | null
  /** what each network did, once it was booked (audit S15) */
  networks: NetworkLine[]
  /** went out on some networks and not on others (audit S7) */
  partial: boolean
  /** any network posts it as a story (audit S3) */
  story: boolean
}

/** The networks a post goes to, in its channel order, each once — plus any that answered (the card's `cardNetworks` does not). */
function outcomeNetworks(post: Pick<PostState, 'channels' | 'outcomes'>, accounts: readonly AccountRef[]): string[] {
  const byId = new Map(accounts.map(a => [a.id, a.platform]))
  const out: string[] = []
  for (const id of post.channels) {
    const p = byId.get(id)
    if (p && !out.includes(p)) out.push(p)
  }
  // a network that answered but whose account has since gone still gets its line
  for (const p of Object.keys(post.outcomes)) if (!out.includes(p)) out.push(p)
  return out
}

/**
 * WHAT EACH NETWORK DID, from the post's own `outcomes` — the one record the
 * publish recorder writes. 'duplicate' means the network says it is already
 * live, so it went out (audit S5). Before a post is booked there is nothing to
 * say per network, so the list is empty.
 */
export function networkLines(post: Pick<PostState, 'stage' | 'channels' | 'outcomes'>, accounts: readonly AccountRef[]): NetworkLine[] {
  if (post.stage !== 'booked' && post.stage !== 'posted') return []
  return outcomeNetworks(post, accounts).map(platform => {
    const o = post.outcomes[platform]
    const base = { platform, network: networkName(platform), url: o?.url ?? null, error: null as string | null }
    if (o?.status === 'published') return { ...base, label: 'Went out', tone: 'done' as const }
    if (o?.status === 'duplicate') return { ...base, label: 'Went out — it was already live', tone: 'done' as const }
    if (o?.status === 'failed') return { ...base, label: 'Did not go out', tone: 'trouble' as const, error: o.error }
    // no answer yet: booked means it is waiting its turn; posted means the
    // network never said — never "scheduled" beside "Posted" (audit S15)
    return { ...base, url: null, label: post.stage === 'booked' ? 'Booked in' : 'No answer yet', tone: 'waiting' as const }
  })
}

/** Does any network post this as a story? Read per network, not off the edit card (audit S3). */
export function isStory(post: Pick<PostState, 'per_channel' | 'channels'>): boolean {
  // only the channels the post still goes to: settings left behind by a
  // channel that was taken off do not make it a story
  return post.channels.some(id => post.per_channel[id]?.kind === 'story')
}

const joinNames = (names: string[]) =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`

/**
 * One tile's facts, now. The clock is passed in, so a page that ticks every
 * minute redraws a time that has just been missed (audit S12).
 */
export function scheduleFacts(post: PostState, accounts: readonly AccountRef[], now: NowLike): ScheduleFacts {
  const missed = slotMissed(post, now)
  const live = liveNetworks(post)
  const failed = failedNetworks(post)
  const partial = post.stage === 'posted' && live.length > 0 && failed.length > 0
  const going = post.stage === 'ready' || post.stage === 'booked'
  const lost = going ? lostChannels(post, accounts) : []

  const alerts: string[] = []
  if (lost.length > 0) {
    alerts.push(`${joinNames(lost)} ${lost.length === 1 ? 'is' : 'are'} not connected — this will not go out until ${lost.length === 1 ? 'it is' : 'they are'} reconnected.`)
  }
  // why it came back from the schedule (a failed booking, or nothing went out)
  if (post.stage === 'ready' && post.problem) alerts.push(post.problem)

  const label = missed ? MISSED_LABEL
    : post.stage === 'posted' ? postedWords(post)
      : STAGE_LABEL[post.stage]

  const tone: StageTone = missed || alerts.length > 0 ? MISSED_TONE
    // live somewhere is good news with a gap in it — amber, never red (audit S7)
    : partial ? 'amber'
      : STAGE_TONE[post.stage]

  return {
    stage: post.stage,
    label,
    tone,
    missed,
    line: waitingOn(post, now).line,
    alert: alerts.length > 0 ? alerts.join(' ') : null,
    networks: networkLines(post, accounts),
    partial,
    story: isStory(post),
  }
}

/* ── what a person may do to it from here ───────────────────────────────── */

const MOVE_REFUSAL: Partial<Record<PostStage, string>> = {
  posted: 'This post has already gone out, so it cannot be moved',
  cancelled: 'This post was cancelled — Re-book it to give it a new time',
  draft: 'This post is still being approved — its time is set on Post approval',
  quality_check: 'This post is still being approved — its time is set on Post approval',
  with_client: 'This post is still being approved — its time is set on Post approval',
}

/**
 * MAY THIS TILE BE DRAGGED TO A NEW TIME? A drag is the "Change time" move
 * (T13/T15) and nothing else, so the answer is `postActions`' own: the same
 * list that draws the window's buttons. Null when it may; else the sentence.
 */
export function moveBlockReason(post: PostState, hats: readonly PostHat[], now: NowLike): string | null {
  const stop = MOVE_REFUSAL[post.stage]
  if (stop) return stop
  const acts = postActions(post, hats, now)
  const change = [acts.primary, ...acts.secondary].find(a => a?.action === 'change_time')
  if (!change) return 'Only a scheduler, an account manager or a super admin can move a post'
  return change.blocked
}

/**
 * THE BIN. `postActions`' danger action and nothing else: "Delete draft" on a
 * draft that was never sent — the row goes (T23) — and "Cancel post" anywhere
 * else (T20). A bin that says Delete and then cancels is audit S1.
 */
export function binAction(post: PostState, hats: readonly PostHat[], now: NowLike): OfferedAction | null {
  return postActions(post, hats, now).danger
}

/* ── the counts, the lists and the feed ─────────────────────────────────── */

type Counted = { stage: PostStage; facts: Pick<ScheduleFacts, 'missed'> }

export type ScheduleCounts = { ready: number; booked: number; posted: number; missed: number; beingApproved: number; drafts: number; cancelled: number }

/** The numbers above the calendar — every one counted off the stage (audit B12). */
export function scheduleCounts(rows: readonly Counted[]): ScheduleCounts {
  const out: ScheduleCounts = { ready: 0, booked: 0, posted: 0, missed: 0, beingApproved: 0, drafts: 0, cancelled: 0 }
  for (const r of rows) {
    if (r.stage === 'ready') out.ready++
    if (r.stage === 'booked') out.booked++
    if (r.stage === 'posted') out.posted++
    if (r.facts.missed && showsOnSchedule(r.stage)) out.missed++
    if (BEING_APPROVED.includes(r.stage)) out.beingApproved++
    if (r.stage === 'draft') out.drafts++
    if (r.stage === 'cancelled') out.cancelled++
  }
  return out
}

/** The List's filters. The first four are the calendar; the last two are lists no grid draws. */
export const LIST_FILTERS = ['all', 'ready', 'booked', 'posted', 'missed', 'drafts', 'cancelled'] as const
export type ListFilter = (typeof LIST_FILTERS)[number]

export const LIST_FILTER_LABEL: Record<ListFilter, string> = {
  all: 'Everything on the schedule',
  ready: STAGE_LABEL.ready,
  booked: STAGE_LABEL.booked,
  posted: STAGE_LABEL.posted,
  missed: 'Missed',
  drafts: 'Drafts',
  cancelled: STAGE_LABEL.cancelled,
}

/** What the List shows under each filter. `all` is the calendar's posts only. */
export function matchesListFilter(row: Counted, filter: ListFilter): boolean {
  switch (filter) {
    case 'all': return showsOnSchedule(row.stage)
    case 'missed': return row.facts.missed && showsOnSchedule(row.stage)
    case 'drafts': return row.stage === 'draft'
    default: return row.stage === filter
  }
}

type PreviewRow = { stage: PostStage; channels: readonly string[]; scheduled_for?: string | null }

/**
 * THE FEED AS IT WILL LOOK: Instagram only, and only what is going out —
 * Ready to post and Booked in (audit S8). What already went out is drawn once,
 * from the account's own feed; only when that feed could not be read are the
 * posted ones drawn from here instead, so they are never shown twice.
 */
export function previewPosts<T extends PreviewRow>(rows: readonly T[], instagramIds: ReadonlySet<string>, feedShown: boolean): T[] {
  return rows.filter(r =>
    r.channels.some(id => instagramIds.has(id))
    && (r.stage === 'ready' || r.stage === 'booked' || (r.stage === 'posted' && !feedShown)))
}
