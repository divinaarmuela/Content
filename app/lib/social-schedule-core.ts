/**
 * The Schedule calendar's rules — pure, no I/O, no `server-only`.
 *
 * Schedule is the post-centric page: a week of hour rows with a tile per
 * PLANNED post. Everything on it that is a decision rather than a pixel lives
 * here, so the drag handler, the composer, the server route and the tests all
 * read one answer.
 *
 * Three rules this module exists to keep straight, all of them already true
 * elsewhere in the codebase and none of them re-invented here:
 *
 *   1. ONLY APPROVED WORK GETS POSTED. Eligibility is `content_items.status`
 *      (workflow-core) plus real slides (`postSlides`, version-files-core).
 *      Nothing here decides what a slide is.
 *   2. THE POST'S APPROVAL IS THE ITEM'S. `social_posts.status` MIRRORS
 *      `content_items.posting_approval_state` (posting-approval-core) and adds
 *      the publish lifecycle on top of it, read off `publish_jobs`. There is
 *      no second state machine, and `mirrorStatus` is a projection, never a
 *      source of truth.
 *   3. A POSTING TIME BELONGS TO THE CLIENT'S ZONE. Which column a tile sits
 *      in is a fact about the audience, so every day key here comes from
 *      `dayKeyInZone`/`wallTimeIn` and every wall time goes back through
 *      `fromZonedInput` — never from arithmetic on an offset.
 *
 * The grid itself is a WALL CALENDAR: its day keys are stepped in UTC
 * arithmetic (the same discipline as work-calendar-core) so that the week the
 * clocks change still has seven days in it, each of them once.
 */

import { publishBlockReason, parseApprovalState } from './posting-approval-core'
import {
  LIVE_JOB_STATUSES, NETWORK_LABEL, optionProblems, PLATFORM_RULES,
  type Platform, type PostKind, type PostOptions,
} from './publish-core'
import { dayKeyInZone, formatInZone, fromZonedInput, safeZone, wallTimeIn } from './timezone-core'
import { postSlides, slidesOf, type Slide, type VersionLike } from './version-files-core'
import { keyToUtc, weekdayIndex, type GridCell } from './work-calendar-core'
import type { ItemStatus } from './workflow-core'

/* ── the post ───────────────────────────────────────────────────────────── */

/** What a planned post can be. The first four MIRROR the item's posting
 *  approval state; the last four are the publish lifecycle underneath it. */
export const SOCIAL_POST_STATUSES = [
  'draft', 'pending', 'approved', 'changes',
  'scheduled', 'published', 'failed', 'cancelled',
] as const
export type SocialPostStatus = (typeof SOCIAL_POST_STATUSES)[number]

/** The tones the restyle draws a tile in. */
export type TileTone = 'amber' | 'red' | 'green' | 'blue' | 'ink' | 'muted' | 'red-outline'

/** Only what this module reads — a row from anywhere may be passed in. */
export type ScheduleItem = {
  status?: string | null
  content_type?: string | null
  posting_approval_state?: unknown
}
export type ScheduleVersion = VersionLike & {
  id?: string
  version_number?: number | null
}
export type SchedulePost = { status?: string | null }
export type ScheduleJob = { status?: string | null }

/* ── eligibility ────────────────────────────────────────────────────────── */

/** The two statuses that mean the client has signed the WORK off. */
const ELIGIBLE_STATUSES: ItemStatus[] = ['approved_for_scheduling', 'scheduled']

/** Why an item cannot start a post — said the way a person would say it. */
const NOT_ELIGIBLE: Partial<Record<ItemStatus, string>> = {
  draft_uploaded: 'Still being made',
  internal_review: 'Still being made',
  revision_required: 'Changes in progress',
  revision_complete: 'Changes in progress',
  client_review: 'Still with the client',
  client_changes_requested: 'Changes in progress',
  published: 'Already posted',
}

/**
 * The statuses "Approve without client" can rescue a piece from.
 *
 * Both are waits on a person, not on work: `internal_review` is waiting for
 * the manager's own check and `client_review` is waiting for the client to
 * answer. Neither is a piece that is still being made, and neither is one the
 * client has already changed their mind about — those need the work doing,
 * not a signature.
 */
export const APPROVE_WITHOUT_CLIENT_STATUSES: ItemStatus[] = ['internal_review', 'client_review']

/**
 * May THIS person sign a piece off without the client, from the Schedule page?
 *
 * The account manager who owns the relationship, and a super admin. A
 * scheduler may not: booking a post in is not the same as deciding the client
 * does not need to see it. Hiding the button is presentation — the refusal
 * itself is `workflow-core`'s edge, checked again on the server.
 */
export function mayApproveWithoutClient(
  role: string | null | undefined,
  status: string | null | undefined,
  /**
   * The item's `client_approval_required` — TRUE unless it was turned off.
   *
   * A client whose contract says they sign everything off is a client the
   * item page will not let a manager skip: `presentTransitions` removes the
   * `→ approved_for_scheduling` edge from every status except `client_review`
   * when the flag is set. Schedule has to answer the same way, or the two
   * screens disagree about a client's own policy — and it is `performTransition`
   * that makes it true rather than presentation on either of them.
   */
  clientApprovalRequired: boolean | null | undefined = true,
): boolean {
  if (role !== 'account_manager' && role !== 'super_admin') return false
  const from = String(status ?? '')
  if (!(APPROVE_WITHOUT_CLIENT_STATUSES as string[]).includes(from)) return false
  // from `client_review` the client HAS been asked; skipping the wait is the
  // manager's call either way
  return from === 'client_review' || clientApprovalRequired === false
}

/** The one line somebody is asked before a client is skipped. */
export function approveWithoutClientQuestion(versionNumber: number | null | undefined): string {
  const which = Number.isFinite(Number(versionNumber)) && Number(versionNumber) > 0
    ? `v${Number(versionNumber)}` : 'this'
  return `Approve ${which} without the client seeing it?`
}

export type Eligibility =
  | { ok: true; version: ScheduleVersion; slides: Slide[] }
  | { ok: false; reason: string }

/**
 * May this item start a post, and with which media?
 *
 * Yes only when the client has approved the work AND the latest version
 * carries at least one slide that would actually go out. `postSlides` decides
 * the second half: a Reel version often carries its cover image as slide two,
 * and that still is a working file, not a post.
 *
 * ── THE ASSUMPTION, STATED, AND WHAT ENFORCES IT ──
 *
 * "The latest version" is taken to BE the version the client approved. Two
 * paths write a version, and BOTH now move the item off
 * `approved_for_scheduling` when they do:
 *
 *   • the item page's upload — `api/production/items/[id]/versions` sends an
 *     approved piece back to `client_review` on the `auto` edge;
 *   • the composer's media picker — `addMediaVersion` does the same, and only
 *     when a genuinely new FILE arrives (a reorder is not a version).
 *
 * So a version the client has not seen cannot sit under an approved status.
 * The one status this does NOT cover is `scheduled`: a piece already booked
 * in has no edge back to the client, and a version added to it would be
 * offered here as approved. Nothing in the app writes one today — the item
 * page's upload leaves it where it is — and closing it properly means a
 * `scheduled → client_review` edge with the provider job cancelled, which is
 * a bigger change than this function.
 *
 * The returned `version` is what every caller must key off (the picker's
 * Approved tab does exactly that) rather than re-reading "the newest" for
 * itself.
 */
export function eligibility(
  item: ScheduleItem | null | undefined,
  versions: readonly ScheduleVersion[] | null | undefined,
): Eligibility {
  const status = String(item?.status ?? '') as ItemStatus
  if (!ELIGIBLE_STATUSES.includes(status)) {
    return { ok: false, reason: NOT_ELIGIBLE[status] ?? 'Not ready yet' }
  }
  const version = latestVersion(versions)
  if (!version) return { ok: false, reason: 'No media yet' }
  const slides = postSlides(item?.content_type, slidesOf(version))
  if (slides.length === 0) return { ok: false, reason: 'No media yet' }
  return { ok: true, version, slides }
}

/** The highest `version_number`; array order is the tie-break and the fallback
 *  for a caller that did not carry the number. */
function latestVersion(
  versions: readonly ScheduleVersion[] | null | undefined,
): ScheduleVersion | null {
  const list = Array.isArray(versions) ? versions.filter(Boolean) : []
  if (list.length === 0) return null
  return list.reduce((best, v) => {
    const a = Number(v?.version_number ?? 0)
    const b = Number(best?.version_number ?? 0)
    return Number.isFinite(a) && a > b ? v : best
  }, list[list.length - 1])
}

/* ── notes on the calendar ──────────────────────────────────────────────── */

/**
 * MAY THIS PERSON REWRITE OR REMOVE SOMEBODY ELSE'S NOTE?
 *
 * The person who wrote it, or an account manager (super admins included, who
 * can do everything an account manager can). A note is often the reason
 * something is NOT being posted — "client is away until the 19th, hold
 * everything" — so anybody being able to overwrite anybody's is one mis-click
 * away from losing the only record of a decision.
 *
 * ONE definition, and it lives here because it is asked in two places: the
 * server, in `editNote`/`removeNote`, where it is enforced; and the calendar,
 * where it decides whether the buttons are drawn. Two copies of a rule is two
 * rules, and the visible half drifting from the enforced one shows people a
 * Delete button that answers 403.
 */
export function mayEditNote(
  user: { id?: string | null; role?: string | null } | null | undefined,
  note: { created_by?: string | null } | null | undefined,
): boolean {
  if (!user || !note) return false
  const role = String(user.role ?? '')
  if (role === 'account_manager' || role === 'super_admin') return true
  const me = String(user.id ?? '')
  return me !== '' && note.created_by === me
}

/* ── the cover picture the editor saved ─────────────────────────────────── */

/** A version, as the cover lookup needs it. */
export type CoverSource = VersionLike & { cover_url?: string | null; file_url?: string | null }

/**
 * THE COVER PICTURE A PERSON CHOSE, FOUND AGAIN AT POSTING TIME.
 *
 * The image editor lets somebody pick the frame of a video that people see
 * before they press play, and stores it on the VERSION (`asset_versions
 * .cover_url`) — the version is where a fact about the file belongs, and it
 * survives the post being cancelled and rebuilt.
 *
 * A cover that is only stored is a control that silently does nothing, so this
 * is the other half: given the file a channel is actually posting, which
 * version holds it, and did that version get a cover. The answer becomes the
 * post's `thumbnailUrl`, which the publisher already knows how to send
 * (YouTube takes it on the media item, Instagram as `instagramThumbnail`).
 *
 * Keyed off the FILE rather than off "the newest version", for the same reason
 * the crop endpoint is: a piece that has moved on would otherwise hand this
 * post a cover belonging to a video nobody is posting.
 */
export function coverForSlide(
  url: string | null | undefined,
  versions: readonly CoverSource[] | null | undefined,
): string | null {
  const want = String(url ?? '').trim()
  if (!want) return null
  for (const v of versions ?? []) {
    const cover = String(v?.cover_url ?? '').trim()
    if (!cover) continue
    if (v.file_url === want || slidesOf(v).some(sl => sl.url === want)) return cover
  }
  return null
}

/* ── the status a tile wears ────────────────────────────────────────────── */

/**
 * What the post IS right now, from the item's approval state and its jobs.
 *
 * A post's OWN status is read first when it is terminal: 'cancelled' is
 * something a person did to this post directly, and it must win even with
 * no jobs behind it — `canReschedule` already refuses to move a cancelled
 * post, and mirroring the item's approval state instead here would make the
 * tile claim it could still be moved when the drag handler would refuse it.
 *
 * Otherwise the jobs win when there are any, because a queued post has moved
 * past the approval question. Their order of precedence, in the
 * multi-channel case:
 *
 *   still going out  → 'scheduled'  — one channel left to go means the post
 *                                     as a whole has not happened yet
 *   anything failed  → 'failed'     — a failure needs a person more than a
 *                                     success needs applause
 *   anything posted  → 'published'
 *   all cancelled    → 'cancelled'
 *
 * With no jobs it is a straight mirror of `posting_approval_state`; an item
 * the gate never touched reads as a draft, which is what it is.
 */
export function mirrorStatus(
  item: ScheduleItem | null | undefined,
  post: SchedulePost | null | undefined,
  jobs: readonly ScheduleJob[] | null | undefined,
): SocialPostStatus {
  if (String(post?.status ?? '') === 'cancelled') return 'cancelled'

  const list = (Array.isArray(jobs) ? jobs : []).map(j => String(j?.status ?? ''))
  if (list.some(s => LIVE_JOB_STATUSES.includes(s))) return 'scheduled'
  if (list.includes('failed')) return 'failed'
  if (list.includes('published')) return 'published'
  if (list.length > 0 && list.every(s => s === 'cancelled')) return 'cancelled'

  const state = parseApprovalState(item?.posting_approval_state)
  if (state) return state
  // the gate was never used on this item: whatever the row calls itself, the
  // post has not been sent anywhere, and that is a draft
  return 'draft'
}

/**
 * Why this post cannot go out yet, in the one sentence the server would
 * refuse with — or null when nothing is in the way.
 *
 * A thin read of `publishBlockReason`, so the tile's tooltip, the composer
 * footer and `/api/social/publish` cannot drift into three different reasons.
 */
export function blockReason(item: ScheduleItem | null | undefined): string | null {
  return publishBlockReason(item?.posting_approval_state)
}

const TONES: Record<SocialPostStatus, TileTone> = {
  pending: 'amber',
  changes: 'red',
  approved: 'green',
  scheduled: 'blue',
  published: 'ink',
  draft: 'muted',
  failed: 'red-outline',
  cancelled: 'muted',
}

/** The tone a tile is drawn in. Anything unrecognised is muted — a tile whose
 *  state we cannot name must not shout. */
export function tileTone(status: string | null | undefined): TileTone {
  return TONES[String(status ?? '') as SocialPostStatus] ?? 'muted'
}

/* ── the week grid ──────────────────────────────────────────────────────── */

const DAY_MS = 86_400_000
const pad = (n: number) => String(n).padStart(2, '0')
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

function keyOfUtc(ms: number): string {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}
/** A day key out of whatever the caller had: a key, or an instant read in tz. */
function toDayKey(start: string | number | Date, tz: string): string | null {
  if (typeof start === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(start.trim())) return start.trim()
  return dayKeyInZone(start, tz)
}

export type WeekDay = {
  index: number
  /** the ISO date key of the column, 'YYYY-MM-DD' in the client's zone */
  iso: string
  day: number
  month: number
  year: number
  weekday: string
  /** "Thu 27 Aug" */
  label: string
}

export type TilePosition = {
  dayIndex: number
  /** pixels from the top of the grid container, header included */
  top: number
  /** minutes past midnight in the client's zone */
  minutes: number
  /** the time is outside the visible hours; `top` has been clamped into them */
  offGrid: boolean
}

export type Slot = {
  dayIndex: number
  dayKey: string
  /** the instant that slot names */
  iso: string
  hour: number
  minute: number
  /** "2:00 pm" */
  label: string
}

export type ScheduleWeekGrid = {
  days: WeekDay[]
  hours: number[]
  tz: string
  fromHour: number
  toHour: number
  rowPx: number
  headerPx: number
  /** the pixel height of the whole grid, header included */
  height: number
  tileTop(iso: string | number | Date | null | undefined): TilePosition | null
  slotAt(dayIndex: number, px: number): Slot | null
}

export type WeekGridOptions = {
  /** any day in the week — a 'YYYY-MM-DD' key, or an instant read in `tz` */
  start: string | number | Date
  tz: string
  fromHour?: number
  toHour?: number
  rowPx?: number
  headerPx?: number
}

/** Clicks land on the quarter hour: nobody means 6:07. */
const SNAP_MINUTES = 15

/**
 * The Monday-first week that contains `start`, with the maths for putting a
 * tile at a time and reading a time back off a click.
 *
 * `tileTop` and `slotAt` are inverses on the quarter hour, which is what makes
 * a drag land where it was dropped rather than a pixel or a DST hour away.
 */
export function scheduleWeekGrid(opts: WeekGridOptions): ScheduleWeekGrid {
  const tz = safeZone(opts.tz)
  const fromHour = clampHour(opts.fromHour ?? 6, 6)
  const toHour = Math.max(fromHour, clampHour(opts.toHour ?? 20, 20))
  const rowPx = Number.isFinite(opts.rowPx) && (opts.rowPx as number) > 0 ? (opts.rowPx as number) : 44
  const headerPx = Number.isFinite(opts.headerPx) && (opts.headerPx as number) >= 0
    ? (opts.headerPx as number)
    : 40

  const anchor = toDayKey(opts.start, tz) ?? keyOfUtc(Date.now())
  const base = keyToUtc(anchor)
  const monday = Number.isNaN(base) ? Date.now() : base - weekdayIndex(anchor) * DAY_MS

  const days: WeekDay[] = Array.from({ length: 7 }, (_, index) => {
    const ms = monday + index * DAY_MS
    const d = new Date(ms)
    const iso = keyOfUtc(ms)
    return {
      index,
      iso,
      day: d.getUTCDate(),
      month: d.getUTCMonth() + 1,
      year: d.getUTCFullYear(),
      weekday: WEEKDAYS[index],
      label: d.toLocaleDateString('en-AU', {
        timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short',
      }).replace(/,\s*/g, ' ').trim(),
    }
  })

  const lo = fromHour * 60
  const hi = toHour * 60
  const topOf = (minutes: number) => headerPx + ((minutes - lo) / 60) * rowPx

  return {
    days,
    hours: Array.from({ length: toHour - fromHour + 1 }, (_, i) => fromHour + i),
    tz,
    fromHour,
    toHour,
    rowPx,
    headerPx,
    height: headerPx + (toHour - fromHour) * rowPx,

    tileTop(iso) {
      const w = iso === null || iso === undefined ? null : wallTimeIn(iso, tz)
      if (!w) return null
      const key = `${w.year}-${pad(w.month)}-${pad(w.day)}`
      const dayIndex = days.findIndex(d => d.iso === key)
      if (dayIndex < 0) return null
      const minutes = w.hour * 60 + w.minute
      const clamped = Math.min(hi, Math.max(lo, minutes))
      return { dayIndex, top: topOf(clamped), minutes, offGrid: clamped !== minutes }
    },

    slotAt(dayIndex, px) {
      if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex > 6) return null
      if (!Number.isFinite(px)) return null
      const raw = lo + ((px - headerPx) / rowPx) * 60
      const snapped = Math.round(raw / SNAP_MINUTES) * SNAP_MINUTES
      const minutes = Math.min(hi, Math.max(lo, snapped))
      const hour = Math.floor(minutes / 60)
      const minute = minutes % 60
      const dayKey = days[dayIndex].iso
      const iso = fromZonedInput(`${dayKey}T${pad(hour)}:${pad(minute)}`, tz)
      if (!iso) return null
      return {
        dayIndex, dayKey, iso, hour, minute,
        label: formatInZone(iso, tz, 'time') ?? clockLabel(hour, minute),
      }
    },
  }
}

function clampHour(v: number, fallback: number): number {
  const n = Math.round(Number(v))
  return Number.isFinite(n) && n >= 0 && n <= 23 ? n : fallback
}

/** "6 pm", "8:30 am" — a time said out loud. */
function clockLabel(hour: number, minute: number): string {
  const h12 = ((hour + 11) % 12) + 1
  const ampm = hour < 12 ? 'am' : 'pm'
  return minute === 0 ? `${h12} ${ampm}` : `${h12}:${pad(minute)} ${ampm}`
}

/* ── the month grid ─────────────────────────────────────────────────────── */

/** Same shape as work-calendar-core's `GridCell` — a month cell IS a grid
 *  cell, so this names the type without re-declaring it. */
export type MonthCell = GridCell

/**
 * A Monday-first 6 × 7 month, always 42 cells.
 *
 * Always six rows, unlike the production board's grid: this one carries post
 * thumbnails, and a month whose row count changes as you page through it makes
 * the tiles jump under the pointer.
 *
 * `tz` is taken so a caller cannot forget which zone these day keys mean —
 * they are the client's, the same keys `dayKeyInZone` produces for a post. The
 * grid itself is a wall calendar and is stepped in UTC, which is why it has
 * seven distinct days in the week the clocks change.
 */
export function monthCells(
  month: string | { year: number; month: number },
  tz?: string,
): MonthCell[] {
  void safeZone(tz ?? null)
  let y: number
  let m: number
  if (typeof month === 'string') {
    const parsed = /^(\d{4})-(\d{1,2})/.exec(month.trim())
    if (!parsed) return []
    y = Number(parsed[1]); m = Number(parsed[2])
  } else {
    y = Math.round(Number(month?.year)); m = Math.round(Number(month?.month))
  }
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return []

  const first = Date.UTC(y, m - 1, 1)
  const lead = (new Date(first).getUTCDay() + 6) % 7
  const start = first - lead * DAY_MS
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start + i * DAY_MS)
    return {
      key: keyOfUtc(start + i * DAY_MS),
      day: d.getUTCDate(),
      month: d.getUTCMonth() + 1,
      year: d.getUTCFullYear(),
      inMonth: d.getUTCMonth() + 1 === m && d.getUTCFullYear() === y,
    }
  })
}

/* ── moving a post ──────────────────────────────────────────────────────── */

export type Reschedule =
  | { ok: true; mode: 'move' | 'requeue' }
  | { ok: false; reason: string }

const NO_MOVE: Record<string, string> = {
  published: 'This post has already gone out, so it cannot be moved',
  failed: 'This post did not go out — start a new one at the time you want',
  cancelled: 'This post was cancelled, so it cannot be moved',
}

/**
 * May this tile be dragged, and what does dropping it cost?
 *
 * 'move' is a write of `scheduled_for` and nothing more. 'requeue' means the
 * provider is already holding the post: the existing job has to be cancelled
 * and a new one queued, so the caller has to be ready for that to fail and to
 * snap the tile back. Anything finished does not move at all.
 */
export function canReschedule(post: SchedulePost | null | undefined): Reschedule {
  const status = String(post?.status ?? '')
  if (status === 'scheduled') return { ok: true, mode: 'requeue' }
  const stop = NO_MOVE[status]
  return stop ? { ok: false, reason: stop } : { ok: true, mode: 'move' }
}

/* ── suggested times ────────────────────────────────────────────────────── */

/** What a network is CALLED, once, so no two screens spell X differently.
 *  It moved down to `publish-core` — where the posting-option refusals that
 *  name a network live — and is re-exported here so every caller is unmoved. */
export { NETWORK_LABEL }

/**
 * Where to start before a client has numbers of their own — the owner's list.
 * These are a starting point, not a claim about this client's audience, and
 * the sentence attached to them says so.
 */
const DEFAULT_TIMES: Record<string, string[]> = {
  instagram: ['11:00', '18:30'],
  tiktok: ['12:00', '19:00'],
  linkedin: ['08:30', '12:30'],
  facebook: ['12:00', '18:00'],
  twitter: ['09:00', '17:00'],
  x: ['09:00', '17:00'],
  youtube: ['15:00', '19:00'],
}
const FALLBACK_TIMES = ['11:00', '18:00']

/** How far back the numbers are read. */
const WINDOW_DAYS = 90
/** At most this many slots on one day. */
const PER_DAY = 3
/** A weekday×hour bucket needs at least this many results before it is
 *  trusted as a pattern rather than a coincidence. */
const MIN_BUCKET_POSTS = 3

/** Only what the rule reads off a `post_analytics` row. */
export type AnalyticsRow = {
  platform?: string | null
  published_at?: string | null
  engagement_rate?: number | null
  likes?: number | null
  comments?: number | null
  shares?: number | null
  saves?: number | null
}

export type SuggestedTime = {
  iso: string
  /** one plain sentence, for the hover */
  why: string
  dayKey: string
  hour: number
  minute: number
  /** did this come from the client's own numbers, or from the starting list */
  source: 'yours' | 'default'
}

export type SuggestedTimesInput = {
  analytics: readonly AnalyticsRow[] | null | undefined
  /** the platform the slots are for — 'twitter' and 'x' are the same network */
  network: string | null | undefined
  tz: string
  now: string | number | Date
  /** how many posts with results it takes before we trust the client's own
   *  numbers over the starting list */
  minPosts?: number
}

/**
 * Up to three good times a day for the next seven days.
 *
 * The client's own numbers when there are enough of them: engagement by
 * weekday × hour over the last ninety days, the best three hours for each
 * weekday. Below the floor — or on a weekday the client has never posted on —
 * the starting list for the network, with a sentence that admits as much.
 *
 * A time that has already gone is never suggested, so today's list shortens as
 * the day goes on rather than offering a slot nobody can use.
 */
export function suggestedTimes(input: SuggestedTimesInput): SuggestedTime[] {
  const tz = safeZone(input.tz)
  const minPosts = Number.isFinite(input.minPosts) ? Number(input.minPosts) : 20
  const nowMs = new Date(input.now as string).getTime()
  if (!Number.isFinite(nowMs)) return []
  const nowIso = new Date(nowMs).toISOString()

  const network = String(input.network ?? '').toLowerCase()
  const label = NETWORK_LABEL[network] ?? 'These'
  const defaults = DEFAULT_TIMES[network] ?? FALLBACK_TIMES

  const byWeekday = learnedHours(input.analytics, network, tz, nowMs, minPosts)

  const today = dayKeyInZone(nowMs, tz)
  if (!today) return []
  const startMs = keyToUtc(today)

  const out: SuggestedTime[] = []
  for (let i = 0; i < 7; i++) {
    const dayKey = keyOfUtc(startMs + i * DAY_MS)
    const weekday = weekdayIndex(dayKey)
    const learned = byWeekday.get(weekday) ?? []
    const slots: { hour: number; minute: number; source: 'yours' | 'default' }[] =
      learned.length > 0
        ? learned.slice(0, PER_DAY).map(h => ({ hour: h, minute: 0, source: 'yours' as const }))
        : defaults.slice(0, PER_DAY).map(t => ({
          hour: Number(t.slice(0, 2)), minute: Number(t.slice(3, 5)), source: 'default' as const,
        }))

    for (const s of slots) {
      const iso = fromZonedInput(`${dayKey}T${pad(s.hour)}:${pad(s.minute)}`, tz)
      if (!iso || iso <= nowIso) continue
      const when = clockLabel(s.hour, s.minute)
      out.push({
        iso, dayKey, hour: s.hour, minute: s.minute, source: s.source,
        why: s.source === 'yours'
          ? `Your posts get the most reactions around ${when} on ${WEEKDAYS[weekday]}s`
          : `${label} posts often do well around ${when} — once you have ${minPosts} posts with results we will use your own numbers`,
      })
    }
  }
  return out.sort((a, b) => a.iso.localeCompare(b.iso))
}

/** weekday (Monday = 0) → the best hours on it, best first. Empty when the
 *  client has not posted enough for their own numbers to mean anything. */
function learnedHours(
  analytics: readonly AnalyticsRow[] | null | undefined,
  network: string,
  tz: string,
  nowMs: number,
  minPosts: number,
): Map<number, number[]> {
  const rows = Array.isArray(analytics) ? analytics : []
  const cutoff = nowMs - WINDOW_DAYS * DAY_MS
  const buckets = new Map<string, { sum: number; count: number }>()
  let counted = 0

  for (const row of rows) {
    if (network && String(row?.platform ?? '').toLowerCase() !== network) continue
    const at = new Date(String(row?.published_at ?? '')).getTime()
    if (!Number.isFinite(at) || at < cutoff || at > nowMs) continue
    const score = engagementOf(row)
    if (score === null) continue
    const w = wallTimeIn(at, tz)
    if (!w) continue
    counted++
    const key = `${weekdayIndex(`${w.year}-${pad(w.month)}-${pad(w.day)}`)}:${w.hour}`
    const b = buckets.get(key) ?? { sum: 0, count: 0 }
    b.sum += score
    b.count++
    buckets.set(key, b)
  }
  if (counted < minPosts) return new Map()

  const perDay = new Map<number, { hour: number; avg: number; count: number }[]>()
  for (const [key, b] of buckets) {
    // one or two posts at an hour is a coincidence, not a pattern — offering
    // it as "your best time" on that evidence would be a guess dressed up as
    // a fact. Three is the floor before a weekday×hour bucket counts.
    if (b.count < MIN_BUCKET_POSTS) continue
    const [weekday, hour] = key.split(':').map(Number)
    const list = perDay.get(weekday) ?? []
    list.push({ hour, avg: b.sum / b.count, count: b.count })
    perDay.set(weekday, list)
  }
  const out = new Map<number, number[]>()
  for (const [weekday, list] of perDay) {
    list.sort((a, b) => b.avg - a.avg || b.count - a.count || a.hour - b.hour)
    out.set(weekday, list.slice(0, PER_DAY).map(x => x.hour))
  }
  return out
}

/** One number for "did this post land". The provider's own rate when it gave
 *  us one; otherwise the reactions a person can count. */
function engagementOf(row: AnalyticsRow): number | null {
  const rate = Number(row?.engagement_rate)
  if (Number.isFinite(rate) && rate > 0) return rate
  const sum = ['likes', 'comments', 'shares', 'saves']
    .map(k => Number((row as Record<string, unknown>)[k]))
    .filter(n => Number.isFinite(n) && n >= 0)
    .reduce((a, b) => a + b, 0)
  return sum > 0 ? sum : null
}

/* ── per-channel slide limits ───────────────────────────────────────────── */

export type SlideLimit = {
  /** the most still pictures this channel will take in one post */
  images: number
  /** the most videos this channel will take in one post */
  videos: number
  /** the most items in one carousel; 0 = this channel has no carousel */
  carousel: number
  /** may that carousel hold pictures and video together */
  mixedCarousel: boolean
}

/**
 * What each channel will take, straight off `PLATFORM_RULES` — per KIND, not
 * one flattened number.
 *
 * A single headline "max" hid the fact that YouTube's ceiling is one VIDEO
 * and zero pictures, not "1 slide": a caller that only ever compared a count
 * against it could tell someone to trim twelve photos down to one photo for
 * a channel that will not take a photo at all.
 */
export function slideLimits(
  platforms: readonly string[] | null | undefined,
): Record<string, SlideLimit> {
  const out: Record<string, SlideLimit> = {}
  for (const p of Array.isArray(platforms) ? platforms : []) {
    const rules = PLATFORM_RULES[String(p) as Platform]
    if (!rules) continue
    out[String(p)] = {
      images: rules.images, videos: rules.videos,
      carousel: rules.carousel, mixedCarousel: rules.mixedCarousel,
    }
  }
  return out
}

/**
 * The slides as this channel would actually receive them.
 *
 * Where the channel will not mix, the kind of the FIRST slide wins and the
 * others go — the first slide is the one somebody chose to lead with. The
 * ceiling is then that KIND's ceiling: even inside a carousel, a channel that
 * will not mix pictures and video (TikTok's `mixedCarousel: false`) still
 * posts at most one VIDEO per post — three videos are not a video carousel,
 * they are three posts squeezed into a limit meant for a photo set. A
 * platform we have no rules for is left alone rather than silently emptied.
 */
export function applySlideLimit(
  slides: readonly Slide[] | null | undefined,
  platform: string,
): Slide[] {
  const list = Array.isArray(slides) ? [...slides] : []
  const rules = PLATFORM_RULES[String(platform) as Platform]
  if (!rules || list.length === 0) return list
  if (rules.carousel > 0) {
    const kind = list[0].type
    const kept = rules.mixedCarousel ? list : list.filter(s => s.type === kind)
    const max = rules.mixedCarousel ? rules.carousel : (kind === 'video' ? rules.videos : rules.carousel)
    return kept.slice(0, max)
  }
  const kept = rules.mixed ? list : list.filter(s => s.type === list[0].type)
  const kind = kept[0]?.type
  const max = kind === 'video' ? rules.videos : rules.images
  return kept.slice(0, max)
}

/* ── one tile, joined ───────────────────────────────────────────────────── */

/** Only what the join reads off a `social_posts` row. */
export type TilePost = {
  item_id?: string | null
  channels?: unknown
  publish_job_ids?: unknown
  scheduled_for?: string | null
  status?: string | null
}
/** A `publish_jobs` row, as the join needs it: its id and its status. */
export type TileJob = ScheduleJob & { id?: string | null }
/** A `social_accounts` row, as the join needs it. */
export type TileAccount = {
  id?: string | null
  platform?: string | null
  /** what we call this channel on screen; the network's name when unset */
  name?: string | null
  /** `false` once the provider tells us the connection is gone */
  active?: boolean | null
}

/** What a tile is drawn from, once the post, its item and its jobs are read
 *  together. Everything here is DERIVED — none of it is stored on the post. */
export type PostTileFacts = {
  /** the status the tile wears, from `mirrorStatus` */
  live_status: SocialPostStatus
  /** the colour that status is drawn in */
  tone: TileTone
  /** the NETWORKS this post goes to — never the account ids the row stores */
  platforms: string[]
  /** the one sentence the server would refuse to post with, or null */
  block_reason: string | null
}

const asStrings = (v: unknown): string[] =>
  (Array.isArray(v) ? v : []).map(x => String(x ?? '')).filter(Boolean)

/**
 * THIS POST'S jobs — matched only by the ids the post itself carries.
 *
 * Never by item. An item can carry a second post after the first was
 * cancelled, and matching by item makes the OLD post's cancelled job speak
 * for the new one: `mirrorStatus` sees "every job cancelled" and marks a
 * brand-new draft `cancelled` without anybody cancelling it. The server
 * (`social-schedule.ts`'s `jobsOf`) matches the same way, so the calendar and
 * the API cannot tell a person two different stories about one post.
 */
export function jobsForPost(
  post: TilePost | null | undefined,
  jobsById: ReadonlyMap<string, TileJob>,
): TileJob[] {
  const out: TileJob[] = []
  for (const id of asStrings(post?.publish_job_ids)) {
    const job = jobsById.get(id)
    if (job) out.push(job)
  }
  return out
}

/**
 * The networks a post goes to.
 *
 * `social_posts.channels` stores ACCOUNT IDS — a client can hold two
 * Instagram accounts, and which one a post goes to is the fact worth keeping.
 * A logo, though, is a fact about the network, so the ids are resolved
 * through the client's accounts. A row that stored a bare platform name
 * (older posts did) is taken at its word rather than dropped.
 */
export function postPlatforms(
  channels: unknown,
  accounts: readonly TileAccount[] | null | undefined,
): string[] {
  const byId = new Map(
    (accounts ?? []).map(a => [String(a?.id ?? ''), String(a?.platform ?? '')] as const))
  const out: string[] = []
  for (const ref of asStrings(channels)) {
    const platform = byId.get(ref) ?? (PLATFORM_RULES[ref as Platform] ? ref : '')
    if (platform && !out.includes(platform)) out.push(platform)
  }
  return out
}

/**
 * A CHANNEL THIS POST GOES TO HAS STOPPED WORKING.
 *
 * The account's token was revoked or expired, Zernio told us, and the row is
 * `active: false`. Nothing about the POST changed — it is still approved, still
 * booked, still sitting on the calendar looking fine — and it will not go out.
 * That is the failure mode worth showing before it happens rather than after,
 * so the tile carries the reason the same way it carries the approval gate's.
 *
 * Derived, never stored: reconnect the account and the sentence is gone on the
 * next frame, without anything having to remember to clear it.
 *
 * ONE RULE, and it is `active === false` — which ONLY the provider's
 * disconnected / revoked / expired webhook writes. It is deliberately NOT the
 * health check's `status` word: that says `warning` while the provider is
 * quietly renewing a login, and a tile shouting "needs reconnecting" over a
 * perfectly good account is how a badge stops being believed. The access
 * page's badge asks `healthBlocksPosting` (`social-access-core.ts`), which
 * refuses `warning` for the same reason, and a test walks both together.
 *
 * Named after the channel, because "an account" is no use to somebody with
 * four of them.
 */
export function channelBlockReason(
  channels: unknown,
  accounts: readonly TileAccount[] | null | undefined,
): string | null {
  const list = asStrings(channels)
  if (list.length === 0) return null
  const dropped = (accounts ?? []).filter(a =>
    a?.active === false && list.includes(String(a?.id ?? '')))
  if (dropped.length === 0) return null
  const nameOf = (a: TileAccount) =>
    (a.name ?? '').trim()
    || NETWORK_LABEL[String(a.platform ?? '').toLowerCase()]
    || String(a.platform ?? 'That account')
  return dropped.length === 1
    ? `${nameOf(dropped[0])} needs reconnecting — this post is on hold until somebody reconnects it`
    : `${dropped.length} of this post’s channels need reconnecting — it is on hold until somebody reconnects them`
}

/**
 * One tile's facts: what this post IS right now, in what colour, on which
 * networks, and what is standing in its way.
 *
 * Pure and separate from the page on purpose — this join is where a calendar
 * quietly starts disagreeing with the API, so it is the part that gets tests.
 */
export function postTileFacts(
  post: TilePost | null | undefined,
  item: ScheduleItem | null | undefined,
  jobsById: ReadonlyMap<string, TileJob>,
  accounts: readonly TileAccount[] | null | undefined,
): PostTileFacts {
  const live = mirrorStatus(item, post as SchedulePost, jobsForPost(post, jobsById))
  return {
    live_status: live,
    tone: tileTone(live),
    platforms: postPlatforms(post?.channels, accounts),
    // the SERVER's reason, read the server's way — `publishBlockReason` on the
    // item's approval state, not a second opinion assembled here. The
    // approval gate comes first when both apply: an unapproved post is not
    // going out whatever its channels are doing.
    block_reason: blockReason(item) ?? channelBlockReason(post?.channels, accounts),
  }
}

/* ── what is on screen ──────────────────────────────────────────────────── */

/** Does this instant fall on one of these days, in the client's zone? */
export function onOneOfDays(
  iso: string | null | undefined,
  tz: string,
  dayKeys: ReadonlySet<string>,
): boolean {
  const key = dayKeyInZone(iso ?? null, tz)
  return key !== null && dayKeys.has(key)
}

/**
 * Is this post on the channel the profiles bar is filtering to?
 *
 * Matches the account id the row stores AND the platform name, so selecting
 * an Instagram profile still finds a post written before ids were stored.
 * No filter means every post.
 */
export function matchesChannel(
  channels: unknown,
  account: TileAccount | null | undefined,
): boolean {
  if (!account) return true
  const list = asStrings(channels)
  const id = String(account.id ?? '')
  const platform = String(account.platform ?? '')
  return (id !== '' && list.includes(id)) || (platform !== '' && list.includes(platform))
}

/**
 * Where the now-line sits on the grid, or null when now is not on it.
 *
 * In the CLIENT's zone, like every other position on this calendar: the line
 * says "this is where the day has got to for the audience", which is a
 * different question from what time it is where the reader is sitting.
 */
export function nowLineTop(
  grid: Pick<ScheduleWeekGrid, 'tz' | 'fromHour' | 'toHour' | 'rowPx' | 'headerPx'>,
  now: string | number | Date,
): number | null {
  const wall = wallTimeIn(now, grid.tz)
  if (!wall) return null
  const minutes = wall.hour * 60 + wall.minute
  const lo = grid.fromHour * 60
  const hi = grid.toHour * 60
  if (minutes < lo || minutes > hi) return null
  return grid.headerPx + ((minutes - lo) / 60) * grid.rowPx
}

/* ── the list view ──────────────────────────────────────────────────────── */

export type ListablePost = { scheduled_for?: string | null }

export type ListGroup<T extends ListablePost> = {
  /** the client's day key, or '' for posts with no time yet */
  dayKey: string
  /** "Thu 27 Aug", or "No time yet" */
  label: string
  posts: T[]
}

/**
 * The list view: posts grouped by the day they land on in the CLIENT's zone,
 * days in order, posts in order within a day.
 *
 * Posts with no time yet lead the list under their own heading rather than
 * disappearing — a draft nobody can find is a draft nobody finishes.
 */
export function groupForList<T extends ListablePost>(
  posts: readonly T[] | null | undefined,
  tz: string,
  /** the client's today, if the caller has it — days near it are named
   *  ("Today", "Tomorrow", "Yesterday") rather than dated, because that is
   *  how anybody reading a list of what is going out thinks about them */
  todayKey?: string | null,
): ListGroup<T>[] {
  const zone = safeZone(tz)
  const groups = new Map<string, T[]>()
  for (const post of Array.isArray(posts) ? posts : []) {
    const key = dayKeyInZone(post?.scheduled_for ?? null, zone) ?? ''
    const list = groups.get(key) ?? []
    list.push(post)
    groups.set(key, list)
  }
  return [...groups.keys()].sort().map(dayKey => ({
    dayKey,
    label: dayKey === ''
      ? 'No time yet'
      : nearbyDayLabel(dayKey, todayKey)
        ?? formatInZone(`${dayKey}T12:00:00Z`, 'UTC', 'date') ?? dayKey,
    posts: groups.get(dayKey)!.sort((a, b) =>
      String(a?.scheduled_for ?? '').localeCompare(String(b?.scheduled_for ?? ''))),
  }))
}

/**
 * "Today", "Tomorrow", "Yesterday" — or null when the day is far enough away
 * that its date is the more useful thing to read.
 */
export function nearbyDayLabel(
  dayKey: string,
  todayKey: string | null | undefined,
): string | null {
  const today = String(todayKey ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || !/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return null
  const days = Math.round((keyToUtc(dayKey) - keyToUtc(today)) / DAY_MS)
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days === -1) return 'Yesterday'
  return null
}

/* ── is this post ready to send ─────────────────────────────────────────── */

export type ComposerChannel = {
  id?: string
  platform: string
  /** what this channel is set to post as, when anything has been chosen */
  kind?: PostKind | null
  /** this channel's own posting options, as the composer holds them */
  options?: PostOptions | null
}

export type CompositionInput = {
  item: ScheduleItem | null | undefined
  version: ScheduleVersion | null | undefined
  slides: readonly Slide[] | null | undefined
  caption: string | null | undefined
  channels: readonly ComposerChannel[] | null | undefined
  scheduledFor: string | null | undefined
  now: string | number | Date
}

/**
 * Everything wrong with this composition, in plain words, all at once.
 *
 * Composition only: whether the item may be posted at all, whether there is
 * something to post, somewhere to post it, words where the channel needs them,
 * and a time that has not already gone. The provider-shaped rules (Reel vs
 * Story, documents, the exact payload) stay in `validatePost`, which the
 * server runs on the way out; this is the sentence the composer shows while
 * somebody is still typing.
 */
export function validateComposition(input: CompositionInput): { ok: boolean; problems: string[] } {
  const problems: string[] = []

  const elig = eligibility(input.item, input.version ? [input.version] : [])
  if (!elig.ok && elig.reason !== 'No media yet') problems.push(elig.reason)

  const slides = Array.isArray(input.slides) ? input.slides : []
  if (slides.length === 0) problems.push('Pick at least one photo or video')

  const channels = (Array.isArray(input.channels) ? input.channels : [])
    .filter(c => c && String(c.platform ?? ''))
  if (channels.length === 0) problems.push('Choose at least one channel')

  const caption = String(input.caption ?? '').trim()
  const limits = slideLimits(channels.map(c => String(c.platform)))
  const seen = new Set<string>()
  for (const channel of channels) {
    const platform = String(channel.platform)
    if (seen.has(platform)) continue
    seen.add(platform)
    const rules = PLATFORM_RULES[platform as Platform]
    const name = NETWORK_LABEL[platform.toLowerCase()] ?? platform
    if (!rules) continue

    // A channel that does not need media is a channel built on words: a
    // picture with nothing said is a post with nothing said.
    if (!caption && !rules.requiresMedia) {
      problems.push(`${name} needs a caption — write a line to go with the picture`)
    }
    if (caption.length > rules.captionMax) {
      problems.push(
        `The caption is too long for ${name} — it takes ${rules.captionMax} letters, this one is ${caption.length}`,
      )
    }
    const limit = limits[platform]
    if (limit) {
      const images = slides.filter(s => s.type === 'image').length
      const videos = slides.filter(s => s.type === 'video').length
      // count by KIND before counting at all: a channel that takes video and
      // no pictures whatsoever (YouTube) is not "too many slides", it is the
      // wrong kind of media — trimming twelve photos to one photo there is
      // a post that still cannot exist
      if (images > 0 && limit.images === 0 && limit.carousel === 0) {
        problems.push(`${name} takes video, not pictures`)
      } else if (videos > 0 && limit.videos === 0) {
        problems.push(`${name} takes pictures, not video`)
      } else {
        const max = limit.carousel > 0 ? limit.carousel : Math.max(limit.images, limit.videos)
        if (slides.length > max) {
          const over = slides.length - max
          problems.push(
            `${name} takes ${max} ${max === 1 ? 'media file' : 'media files'} — take ${over} out`,
          )
        }
      }
    }
  }

  // …and everything wrong with a channel's own posting options. The rule is
  // `optionProblems`, the SAME function the server runs on the way out, so
  // the window never approves of a post the publisher would refuse.
  const media = slides.map(s => ({
    url: s.url, type: s.type === 'video' ? 'video' as const : 'image' as const,
  }))
  for (const channel of channels) {
    const platform = String(channel.platform) as Platform
    if (!PLATFORM_RULES[platform]) continue
    const own: PostOptions = channel.options ?? {}
    const name = NETWORK_LABEL[platform] ?? platform
    for (const problem of optionProblems(
      platform, { ...own, kind: own.kind ?? channel.kind ?? undefined }, media, caption,
    )) {
      // the sentence names its own network wherever the network matters; the
      // ones that do not are prefixed so nobody has to guess which channel
      problems.push(problem.includes(name) ? problem : `${name}: ${problem}`)
    }
  }

  if (input.scheduledFor) {
    const when = new Date(input.scheduledFor).getTime()
    const now = new Date(input.now as string).getTime()
    if (!Number.isFinite(when)) {
      problems.push('That is not a time we can read — pick one from the calendar')
    } else if (Number.isFinite(now) && when <= now) {
      problems.push('That time has already gone — pick a later one')
    }
  }

  return { ok: problems.length === 0, problems }
}
