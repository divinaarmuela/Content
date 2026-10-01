/**
 * A PAGE FOR EVERY POST — the pure half.
 *
 * The owner asked for one address per post: not a panel, not a section on a
 * card, but a page you can send somebody. Everything that page decides
 * without touching a database is here — the address itself, the words for
 * where a post got to, the names of the per-channel settings read back, the
 * shape of the day-by-day graph, and the sentences for the four kinds of
 * nothing (no numbers yet, a private account, a platform that does not tell
 * us who liked, nobody said anything).
 *
 * Three rules carried over from `post-performance-core`, because a second
 * screen is exactly where they get broken:
 *
 *   1. **Absent is not zero.** A figure a platform does not publish is not
 *      drawn, not drawn as a zero.
 *   2. **Nothing invents a word.** Every name for a setting comes from the
 *      composer's own option rows (`extraLabel`); every name for a network
 *      comes from `NETWORK_LABEL`. A page that spells a database key into
 *      words is a page whose vocabulary drifts from the window people typed
 *      it in.
 *   3. **Never a blank.** Every function answers something a page can print
 *      for a post with no data at all.
 */
import { NETWORK_LABEL } from './social-schedule-core'
import type { TileTone } from './social-schedule-core'
import { STAGE_LABEL, STAGE_MEANING, STAGE_TONE, postedWords, type PostStage, type PostState } from './post-stage-core'
import { extraLabel, extraValueWords, type ChannelExtras } from './schedule-compose-core'
import type { SparkPoint } from './post-performance-core'

/* ── the address ───────────────────────────────────────────────────────── */

/** The post's own page, keyed by the `social_posts` id. */
export function postPageHref(postId: string): string {
  return `/dashboard/social/posts/${encodeURIComponent(postId)}`
}

/** The client's version of the same page, behind their share token. */
export function portalPostHref(token: string, postId: string): string {
  return `/portal/${encodeURIComponent(token)}/post/${encodeURIComponent(postId)}`
}

/** The Inbox, opened on this post's conversation when we know its id. */
export function inboxHref(providerPostId: string | null | undefined): string {
  return providerPostId
    ? `/dashboard/social/inbox?post=${encodeURIComponent(providerPostId)}`
    : '/dashboard/social/inbox'
}

/* ── which cached rows are THIS post's ─────────────────────────────────── */

/** Only what the match reads off a `post_analytics` row. */
export type AnalyticsRowRef = {
  item_id?: string | null
  publish_job_id?: string | null
  published_at?: string | null
}

/**
 * The rows the sweeps wrote for one post, newest first.
 *
 * Matched on the post's OWN job ids first (`jobIdsOfPost`), for a reason:
 * a card can carry a second post
 * after the first was cancelled, and matching by card alone lets the old
 * post's numbers speak for the new one. The card is the fallback only for a
 * post with no jobs of its own to disagree with (a post matched to something
 * published by hand), never as well.
 */
export function analyticsForPost<T extends AnalyticsRowRef>(
  rows: readonly T[],
  post: { item_id: string; publish_job_ids?: unknown },
): T[] {
  const jobIds = new Set(
    (Array.isArray(post.publish_job_ids) ? post.publish_job_ids : [])
      .map(x => String(x ?? '')).filter(Boolean))
  const mine = rows.filter(r => r.publish_job_id != null && jobIds.has(r.publish_job_id))
  const chosen = mine.length > 0
    ? mine
    : jobIds.size === 0
      ? rows.filter(r => r.item_id === post.item_id)
      : []
  return [...chosen].sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''))
}

/* ── the client's chip ─────────────────────────────────────────────────── */

export type ClientChipTone = 'blue' | 'green' | 'amber' | 'muted'
const CLIENT_TONES: ClientChipTone[] = ['blue', 'green', 'amber', 'muted']

/** Stable per client, out of the palette's tints — the same client wears the
 *  same colour on the card, the board and this page. */
export function clientTone(seed: string | null | undefined): ClientChipTone {
  let n = 0
  for (const ch of String(seed ?? '')) n = (n * 31 + ch.charCodeAt(0)) >>> 0
  return CLIENT_TONES[n % CLIENT_TONES.length]
}

/* ── where the post got to ─────────────────────────────────────────────── */

export type PostStatusWords = { headline: string; detail: string | null; tone: TileTone }

/**
 * THE HEADER'S STATUS, from the post's STAGE (decision 12) in the one list's
 * words — STAGE_LABEL, STAGE_MEANING, and `postedWords` for a post that went
 * out ("Posted on 1 of 2 — LinkedIn did not go out"). No old status word is
 * read or made. A post back in Ready to post after a failed booking says why.
 * A row not yet moved across to stages (`state` null) is Posted when
 * something went out, else Draft.
 */
export function postPageStatus(
  state: Pick<PostState, 'stage' | 'outcomes' | 'problem'> | null,
  opts: { whenLabel?: string | null; failure?: string | null; wentOut?: boolean } = {},
): PostStatusWords {
  const when = opts.whenLabel?.trim() || null
  const stage: PostStage = state?.stage ?? (opts.wentOut ? 'posted' : 'draft')
  const problem = stage === 'ready' ? (state?.problem?.trim() || opts.failure?.trim() || null) : null
  const tone = STAGE_TONE[stage]
  return {
    headline: stage === 'posted' && state ? postedWords(state) : STAGE_LABEL[stage],
    detail: stage === 'posted' ? (when ? `Went out ${when}.` : STAGE_MEANING.posted)
      : stage === 'booked' ? (when ? `Goes out ${when}. Nothing to do — it leaves by itself.` : STAGE_MEANING.booked)
      : problem ?? STAGE_MEANING[stage],
    tone: problem ? 'red' : tone === 'surface' ? 'muted' : tone,
  }
}

/** The network's own name — never the raw platform key. */
export function networkName(platform: string | null | undefined): string {
  const key = String(platform ?? '').toLowerCase()
  return NETWORK_LABEL[key] ?? (key ? key : 'The platform')
}

/* ── the per-channel settings, read back ───────────────────────────────── */

export type ChannelExtraLine = { field: string; label: string; value: string }

/**
 * One channel's extras as lines a person can read.
 *
 * The label is the composer's own row label and the value is the composer's
 * own choice text; a field neither can name is skipped rather than guessed
 * at. `slides` is left out on purpose — a channel's own pictures are shown as
 * pictures further up the page, not as a line of text.
 */
export function channelExtraLines(
  extras: ChannelExtras | null | undefined,
  platform: string | null | undefined,
): ChannelExtraLine[] {
  const out: ChannelExtraLine[] = []
  for (const [field, value] of Object.entries(extras ?? {})) {
    if (field === 'slides' || field === 'caption') continue
    const key = field as keyof ChannelExtras
    const label = extraLabel(key, platform)
    const words = extraValueWords(key, value, platform)
    if (!label || !words) continue
    out.push({ field, label, value: words })
  }
  return out
}

/* ── when there is nothing to show ─────────────────────────────────────── */

/** Nobody has said anything under the post yet. */
export const NO_COMMENTS_LINE = 'Nobody has commented yet.'

/* ── the day-by-day graph ──────────────────────────────────────────────── */

export type ChartPoint = { date: string; value: number; x: number; y: number }
export type ChartGrid = { y: number; value: number }
export type ChartBox = {
  width: number; height: number
  left: number; right: number; top: number; bottom: number
}

export type DayChart = {
  box: ChartBox
  points: ChartPoint[]
  line: string
  area: string
  grid: ChartGrid[]
  /** the highest gridline, which is also the top of the plot */
  max: number
  /** the y of zero — every fill is anchored here, never to the lowest value */
  base: number
  first: string | null
  last: string | null
}

export const CHART_BOX: ChartBox = { width: 640, height: 200, left: 40, right: 12, top: 14, bottom: 26 }

/**
 * A round number at or above the highest point, so the top gridline is a
 * figure somebody can read rather than "1,837".
 */
export function niceCeiling(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1
  const pow = Math.pow(10, Math.floor(Math.log10(value)))
  for (const step of [1, 2, 2.5, 5, 10]) {
    const candidate = step * pow
    if (candidate >= value) return Math.round(candidate)
  }
  return Math.round(10 * pow)
}

/**
 * The geometry of the day-by-day graph — pure, so a test pins it and both
 * themes draw exactly the same shape in their own ink.
 *
 * Zero-anchored: the area is the amount, and an area that starts at the
 * lowest value is a picture of a different, larger number. Four gridlines,
 * the top one a round figure.
 */
export function dayChart(
  series: readonly SparkPoint[] | null | undefined,
  box: ChartBox = CHART_BOX,
  lines = 4,
): DayChart {
  const rows = (series ?? []).filter(p => p && typeof p.date === 'string' && Number.isFinite(p.value))
  const innerW = box.width - box.left - box.right
  const innerH = box.height - box.top - box.bottom
  const base = box.top + innerH
  const max = niceCeiling(Math.max(0, ...rows.map(p => p.value)))
  const grid: ChartGrid[] = []
  for (let i = 0; i <= lines; i++) {
    const value = (max / lines) * i
    grid.push({ y: +(base - (value / max) * innerH).toFixed(2), value: Math.round(value) })
  }
  if (rows.length === 0) {
    return { box, points: [], line: '', area: '', grid, max, base, first: null, last: null }
  }
  const step = rows.length > 1 ? innerW / (rows.length - 1) : 0
  const points: ChartPoint[] = rows.map((p, i) => ({
    date: p.date,
    value: p.value,
    x: +(box.left + (rows.length > 1 ? i * step : innerW / 2)).toFixed(2),
    y: +(base - (p.value / max) * innerH).toFixed(2),
  }))
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ')
  const area = `${line} L${points[points.length - 1].x} ${base} L${points[0].x} ${base} Z`
  return {
    box, points, line, area, grid, max, base,
    first: rows[0].date,
    last: rows[rows.length - 1].date,
  }
}

/** "5 Sep" — the axis label, in the reader's own locale-free short form. */
export function shortDate(day: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day ?? ''))
  if (!m) return ''
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? ''}`.trim()
}

/** What the graph is called, out loud, for a reader who cannot see it. */
export function chartLabel(days: number): string {
  if (days <= 0) return 'Interactions day by day — nothing counted yet'
  return days === 1
    ? 'Interactions on the first day'
    : `Interactions day by day, over ${Math.min(days, 30)} days`
}

/* ── the per-channel breakdown ─────────────────────────────────────────── */

export type ChannelNumbers = {
  platform: string
  label: string
  interactions: number | null
  /** the live link for this channel, when the platform handed one back */
  url: string | null
}

/** Only worth drawing when the post actually went to more than one network. */
export function showsBreakdown(rows: readonly ChannelNumbers[] | null | undefined): boolean {
  return (rows?.length ?? 0) > 1
}
