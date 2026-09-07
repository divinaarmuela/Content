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
import type { SocialPostStatus, TileTone } from './social-schedule-core'
import { extraLabel, extraValueWords, type ChannelExtras } from './schedule-compose-core'
import type { Interactor, Interactors } from './followers-core'
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
 * Matched on the post's OWN job ids first — the same rule `jobsForPost` uses
 * on the calendar, and for the same reason: a card can carry a second post
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
 * The header's status, in three words and a sentence.
 *
 * Only the three the owner named get their own headline — booked in, posted,
 * failed — because those are the three a person opening this page is asking
 * about. Everything before sending keeps the composer's own words.
 */
export function postStatusWords(
  status: SocialPostStatus | string | null | undefined,
  opts: { whenLabel?: string | null; failure?: string | null } = {},
): PostStatusWords {
  const when = opts.whenLabel?.trim() || null
  switch (String(status ?? '')) {
    case 'published':
      return { headline: 'Posted', detail: when ? `Went out ${when}.` : null, tone: 'ink' }
    case 'scheduled':
      return {
        headline: 'Booked in',
        detail: when ? `Goes out ${when}. Nothing to do — it leaves by itself.` : 'It leaves by itself.',
        tone: 'blue',
      }
    case 'failed':
      return {
        headline: 'Failed',
        detail: opts.failure?.trim() || 'The platform refused it and did not say why.',
        tone: 'red',
      }
    case 'cancelled':
      return { headline: 'Cancelled', detail: 'Somebody pulled it back. It did not go out.', tone: 'muted' }
    case 'approved':
      return { headline: 'Ready to post', detail: 'Signed off — a scheduler books it in.', tone: 'green' }
    case 'pending':
      return { headline: 'With the client', detail: 'Waiting on their sign-off.', tone: 'amber' }
    case 'changes':
      return { headline: 'Changes asked for', detail: 'The client wants something different.', tone: 'red' }
    default:
      return { headline: 'Draft', detail: 'Not sent anywhere yet.', tone: 'muted' }
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

/* ── who liked, who said something ─────────────────────────────────────── */

/** The faces and names behind a list of handles, in the order they were read. */
export function peopleFrom(
  interactors: Interactors | null | undefined,
  which: 'likers' | 'commenters',
): Interactor[] {
  const handles = interactors?.[which] ?? []
  const known = interactors?.people ?? {}
  const seen = new Set<string>()
  const out: Interactor[] = []
  for (const raw of handles) {
    const username = String(raw ?? '').trim()
    if (!username || seen.has(username)) continue
    seen.add(username)
    out.push(known[username] ?? { username, full_name: null, profile_pic: null })
  }
  return out
}

/** "18 people liked it" · "1 person liked it" · null for none. */
export function likedLine(n: number): string | null {
  if (n <= 0) return null
  return n === 1 ? '1 person liked it' : `${n} people liked it`
}

/* ── the four kinds of nothing ─────────────────────────────────────────── */

/**
 * WHO liked is a different question from HOW MANY, and only one platform
 * answers it. The count comes from the posting service for every network;
 * the names come from the follower reader, which reads public Instagram
 * profiles and nothing else. So a TikTok post has a likes number and no
 * names, and saying so is better than an empty box.
 */
export function whoLikedNote(platform: string | null | undefined): string | null {
  const key = String(platform ?? '').toLowerCase()
  if (key === 'instagram') return null
  return `Likes aren’t available for ${networkName(platform)} — only Instagram says who liked a post.`
}

/** The account is private, so nobody outside it can be read. */
export const PRIVATE_ACCOUNT_NOTE =
  'This account is private, so who liked and who commented cannot be read from outside it. '
  + 'The totals are still the platform’s own.'

/** Nobody has said anything under the post yet. */
export const NO_COMMENTS_LINE = 'Nobody has commented yet.'

/** The names have not been read yet — the daily look has not come round. */
export const NAMES_PENDING_LINE = 'Who liked and who commented is read once a day — check back tomorrow.'

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
