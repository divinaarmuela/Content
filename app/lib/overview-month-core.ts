/**
 * "This month across clients" — the Overview's one-screen answer to *what did
 * every client actually get, and where does that leave us?*
 *
 * Pure. No I/O, no database, no dates read from the machine unless a caller
 * hands them in. The route gathers rows; this decides what they MEAN:
 *
 *   - **Posted is the only delivery.** Same rule the agreement tab runs on
 *     (`agreement-core`): approved-but-unposted is not delivered, so a client
 *     with four reels in the calendar and none live is still short four.
 *   - **A status is derived, never stored.** Met when every promised type is
 *     fully posted; otherwise the worst per-type pace decides — `behind` reads
 *     "Short by N", `tight` reads "At risk", anything else "On track".
 *   - **Absent is not zero** (borrowed from post-analytics-core). A month with
 *     no analytics rows yet has `views: null`, which the table prints as "—".
 *     Summing nulls to 0 would report a real audience of zero.
 *   - **Order is triage.** Short first, then at risk, on track, met, and last
 *     the clients with no agreement on file — a row that is a to-do, not a
 *     measurement.
 */
import { type PaceStatus } from './agreement-core'
import { melbourneMonthKey, metricForType, PORTAL_TZ } from './post-analytics-core'

/** The four chips the table can show. Not the same alphabet as PaceStatus:
 *  a client reads "Short by 3", not "behind". */
export type MonthStatus = 'short' | 'at_risk' | 'on_track' | 'met'

/** One promised content type inside a client's row. */
export type MonthTypeLine = {
  type: string
  label: string
  /** what the agreement (or this month's override) promised */
  promised: number
  posted: number
  scheduled: number
  in_production: number
  pace: PaceStatus
}

/** The month's most recent live post, and the item to open for it. */
export type LastPost = { at: string; item_id: string | null; title?: string | null }

/** A cached analytics row, joined to the type of piece it came from. */
export type MonthAnalyticsRow = {
  content_type?: string | null
  published_at?: string | null
  views?: number | null
  reach?: number | null
  impressions?: number | null
}

/** What the route hands in, per client. */
export type MonthClientInput = {
  id: string
  name: string
  has_agreement: boolean
  /** the agreement starts after this month — nothing is owed yet */
  not_started?: boolean
  lines?: MonthTypeLine[]
  last_post?: LastPost | null
  analytics?: MonthAnalyticsRow[]
  /** this client's own zone. The table spans clients, so there is no single
   *  "this month" for the page — each row's month boundary is its own. */
  tz?: string | null
}

/** One table row, ready to render. */
export type MonthClientRow = {
  id: string
  name: string
  has_agreement: boolean
  not_started: boolean
  promised: number
  posted: number
  scheduled: number
  in_production: number
  /** how many pieces are still owed across every type — 0 once met */
  short_by: number
  status: MonthStatus
  status_label: string
  lines: MonthTypeLine[]
  last_post: LastPost | null
  /** null = nothing measured yet, which is NOT zero views */
  views: number | null
  /** the client's own zone, so whoever renders this row's dates renders them
   *  on the same calendar the row was counted on */
  tz: string
}

/** "2026-08" for a month/year pair — the key `melbourneMonthKey` produces. */
export function monthKeyOf(month: number, year: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
}

/** Worst-first, so a reduce can pick the line that decides the row. */
const PACE_RANK: Record<PaceStatus, number> = { behind: 0, tight: 1, on_track: 2, met: 3 }

/** How many pieces are still owed, across every promised type. */
export function shortfallOf(lines: MonthTypeLine[]): number {
  return (lines ?? []).reduce((n, l) => n + Math.max(0, l.promised - l.posted), 0)
}

/**
 * The chip.
 *
 * "Met" is the strict reading the owner asked for: every promised type has
 * posted >= promised. Nothing promised at all is met too — there is no way to
 * be short of nothing. Below that, the worst-paced line names the row, so one
 * type falling behind is never hidden by five that are fine.
 */
export function monthStatusOf(lines: MonthTypeLine[]): MonthStatus {
  const ls = lines ?? []
  if (ls.length === 0) return 'met'
  if (shortfallOf(ls) === 0) return 'met'
  const worst = ls.reduce<PaceStatus>((w, l) => (PACE_RANK[l.pace] < PACE_RANK[w] ? l.pace : w), 'met')
  if (worst === 'behind') return 'short'
  if (worst === 'tight') return 'at_risk'
  return 'on_track'
}

/** The chip's words. "Short by 3" carries the number; the rest are states. */
export function monthStatusLabel(status: MonthStatus, shortBy: number): string {
  switch (status) {
    case 'met': return 'Met'
    case 'on_track': return 'On track'
    case 'at_risk': return 'At risk'
    case 'short': return shortBy > 0 ? `Short by ${shortBy}` : 'Short'
  }
}

/** "Reels 2/4" — one promised type, posted against promised. */
export function expandLine(line: MonthTypeLine): string {
  return `${line.label} ${line.posted}/${line.promised}`
}

/** "Reels 2/4 · Graphics 3/3" — the whole promise on one line, for the
 *  tooltip on Promised and the expanded row under it. */
export function expandSummary(lines: MonthTypeLine[]): string {
  return (lines ?? []).map(expandLine).join(' · ')
}

/**
 * Views for the month — the figure each kind of piece is judged on.
 *
 * A reel is watched (views, falling back to impressions); a graphic is seen
 * (reach, then impressions, then views). Rows outside the month are skipped,
 * and so are rows whose numbers have not landed yet: if NOTHING contributed a
 * finite number the answer is `null`, because "0 views" and "the platform has
 * not counted yet" are different facts and only one of them is true.
 */
export function sumMonthViews(
  rows: MonthAnalyticsRow[] | null | undefined,
  monthKey: string,
  tz: string = PORTAL_TZ,
): number | null {
  let total = 0
  let counted = 0
  for (const r of rows ?? []) {
    if (!r?.published_at) continue
    if (melbourneMonthKey(r.published_at, tz) !== monthKey) continue
    const value = metricForType(r.content_type) === 'views'
      ? r.views ?? r.impressions ?? null
      : r.reach ?? r.impressions ?? r.views ?? null
    if (typeof value === 'number' && Number.isFinite(value)) { total += value; counted++ }
  }
  return counted === 0 ? null : total
}

/** Triage order: act on the short ones first, and the clients with no
 *  agreement drop to the bottom — that row is a task, not a measurement. */
const STATUS_RANK: Record<MonthStatus, number> = { short: 0, at_risk: 1, on_track: 2, met: 3 }

export function sortRank(row: Pick<MonthClientRow, 'has_agreement' | 'status'>): number {
  return row.has_agreement ? STATUS_RANK[row.status] : 4
}

/** One client's input, decided. */
export function buildMonthRow(
  input: MonthClientInput,
  monthKey: string,
  tz: string = PORTAL_TZ,
): MonthClientRow {
  const lines = input.lines ?? []
  const hasAgreement = input.has_agreement && lines.length > 0
  const shortBy = hasAgreement ? shortfallOf(lines) : 0
  const status = hasAgreement ? monthStatusOf(lines) : 'met'
  const sum = (pick: (l: MonthTypeLine) => number) => lines.reduce((n, l) => n + pick(l), 0)
  return {
    id: input.id,
    name: input.name,
    has_agreement: hasAgreement,
    not_started: input.not_started === true,
    promised: sum(l => l.promised),
    posted: sum(l => l.posted),
    scheduled: sum(l => l.scheduled),
    in_production: sum(l => l.in_production),
    short_by: shortBy,
    status,
    status_label: monthStatusLabel(status, shortBy),
    lines,
    last_post: input.last_post ?? null,
    views: sumMonthViews(input.analytics, monthKey, input.tz || tz),
    tz: input.tz || tz,
  }
}

/** Every client, decided and ordered — the table's whole payload. */
export function buildMonthRows(
  inputs: MonthClientInput[],
  monthKey: string,
  tz: string = PORTAL_TZ,
): MonthClientRow[] {
  return (inputs ?? [])
    .map(i => buildMonthRow(i, monthKey, tz))
    .sort((a, b) => sortRank(a) - sortRank(b) || a.name.localeCompare(b.name))
}

/** What the muted row says for a client we have no deal on file for. */
export const NO_AGREEMENT_LINE = 'No agreement on file — set one up'
