/**
 * Pure logic for the Team activity page — no I/O, no database, no clock read
 * unless a caller hands one in.
 *
 * The page answers one question a manager asks out loud every morning: *who
 * is holding what, who is free, and what is late?* The route gathers rows;
 * this decides what they MEAN, and three rules do most of the work:
 *
 *   1. **Holding is assignment, not authority.** A person holds an item when
 *      they own it, or when the SCHEDULING was handed to them. Being an
 *      account manager does not mean holding every item in review — that is
 *      the job, and a workload column that counts the job is a column of the
 *      same number repeated.
 *   2. **Finished is "nobody's turn".** Every overlay already publishes a turn
 *      table (asset, shoot brief, internal task), and the last stage of each
 *      hands over to nobody. So "done" is read from the same table the item's
 *      own page reads, rather than a second list of end statuses that drifts
 *      from it. Nothing finished can be overdue.
 *   3. **A due date is a day in SOMEBODY's zone.** The team spans Melbourne
 *      and Manila; "due today" is not the same instant for both. Buckets are
 *      computed against a day key the caller supplies, so the page can render
 *      each person's work on the calendar that person is working off.
 *
 * The throughput figures are the agency week (Melbourne, Monday to Sunday),
 * because that is the week the business reports on — a person's own week would
 * make two colleagues' numbers uncomparable.
 */

import { DEFAULT_TZ, dayKeyInZone, fromZonedInput } from './timezone-core'
import {
  STATUS_LABELS, STATUS_TURN, schedulerIdsOf, whoseTurn,
  type ActingItem, type ItemStatus,
} from './workflow-core'
import {
  BRIEF_KIND_LABELS, BRIEF_STATUS_TURN, SHOOT_BRIEF_SLUG,
} from './brief-task-core'
import { TASK_KIND_LABELS, TASK_STATUS_TURN, isInternalKind, type KindShape } from './task-kind-core'
import type { Role } from './identity-core'

/** The agency's own week — the one every throughput number is counted on. */
export const AGENCY_TZ = DEFAULT_TZ

/** The three overlays an item wears. The same three the detail page branches on. */
export type ItemOverlay = 'asset' | 'brief' | 'task'

/** The work kind, narrowed to what crosses the wire: JSON has no `null`
 *  distinction worth keeping here, and the work-page scopes are typed on the
 *  optional form, so normalising once at the edge keeps every consumer happy. */
export type WorkKind = { slug?: string; uses_media?: boolean }

/** One item, as the route hands it over. */
export type HeldItem = {
  id: string
  title: string
  status: ItemStatus
  owner_id: string | null
  scheduler_ids?: unknown
  due_date: string | null
  client_id: string
  client_name?: string | null
  work_kinds?: WorkKind | null
}

/** A workflow_activity row, reduced to the two fields that carry meaning. */
export type ActivityRow = { created_at: string; action: string; new_value?: string | null }

/** Which overlay this item wears. */
export function overlayOf(item: { work_kinds?: KindShape }): ItemOverlay {
  const kind = item.work_kinds
  if ((kind?.slug ?? '') === SHOOT_BRIEF_SLUG) return 'brief'
  if (isInternalKind(kind)) return 'task'
  return 'asset'
}

/** The turn table this item is judged by — its own vocabulary, not the asset's. */
export function turnsFor(overlay: ItemOverlay): Record<ItemStatus, Role | null> {
  if (overlay === 'brief') return BRIEF_STATUS_TURN
  if (overlay === 'task') return TASK_STATUS_TURN
  return STATUS_TURN
}

/** What this stage is CALLED, in the item's own words. */
export function statusWordOf(item: { status: ItemStatus; work_kinds?: KindShape }): string {
  const overlay = overlayOf(item)
  if (overlay === 'brief') return BRIEF_KIND_LABELS[item.status] ?? STATUS_LABELS[item.status]
  if (overlay === 'task') return TASK_KIND_LABELS[item.status] ?? STATUS_LABELS[item.status]
  return STATUS_LABELS[item.status]
}

/**
 * Is there nothing left to do on this?
 *
 * Read from the item's OWN turn table rather than a hard-coded list of end
 * statuses: a booked shoot brief is finished at `scheduled`, an approved task
 * is finished at `approved_for_scheduling`, and an asset is finished only once
 * it is live. All three already say so where the item's page reads it.
 */
export function isFinished(item: { status: ItemStatus; work_kinds?: KindShape }): boolean {
  return turnsFor(overlayOf(item))[item.status] === null
}

/** Whether a person HOLDS an item: they own it, or its scheduling is theirs. */
export function holds(item: HeldItem, personId: string): boolean {
  return item.owner_id === personId || schedulerIdsOf(item).includes(personId)
}

// ─── Dates ───────────────────────────────────────────────────────────────

/** 'YYYY-MM-DD' plus n days. Pure string arithmetic via a UTC midnight — no
 *  zone is involved, because a day key is already a calendar date. */
export function addDaysKey(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number)
  const t = Date.UTC(y, (m ?? 1) - 1, d ?? 1) + n * 86_400_000
  const dt = new Date(t)
  const pad = (x: number) => String(x).padStart(2, '0')
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

/** Monday = 0 … Sunday = 6, for a day key. The week the team calls a week. */
export function weekdayIndex(key: string): number {
  const [y, m, d] = key.split('-').map(Number)
  return (new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1)).getUTCDay() + 6) % 7
}

export type WeekRange = {
  /** Monday and Sunday, as day keys in `tz` */
  startKey: string
  endKey: string
  /** the instants that week begins and ends at, for filtering timestamps */
  startIso: string
  endIso: string
}

/**
 * The Monday-to-Sunday week `now` falls in, read on `tz`'s calendar.
 *
 * `endIso` is the instant the NEXT Monday begins, so the filter is
 * `>= startIso && < endIso` — a half-open range, which is the only kind that
 * cannot drop a post made in the last second of Sunday night.
 */
export function weekRangeInZone(now: Date, tz: string = AGENCY_TZ): WeekRange {
  const today = dayKeyInZone(now, tz) ?? '1970-01-01'
  const startKey = addDaysKey(today, -weekdayIndex(today))
  const endKey = addDaysKey(startKey, 6)
  return {
    startKey,
    endKey,
    startIso: fromZonedInput(`${startKey}T00:00`, tz) ?? new Date(0).toISOString(),
    endIso: fromZonedInput(`${addDaysKey(endKey, 1)}T00:00`, tz) ?? now.toISOString(),
  }
}

/** The last `days` day keys in `tz`, oldest first, ending on today. */
export function recentDayKeys(now: Date, days = 14, tz: string = AGENCY_TZ): string[] {
  const today = dayKeyInZone(now, tz) ?? '1970-01-01'
  return Array.from({ length: days }, (_, i) => addDaysKey(today, i - (days - 1)))
}

// ─── Due dates ───────────────────────────────────────────────────────────

/** Where a due date files an item, relative to a person's own today. */
export type DueBucket = 'overdue' | 'today' | 'week' | 'later' | 'none'

/**
 * The bucket, decided.
 *
 * `none` covers both "no date" and "nothing left to do": an item nobody has a
 * move on is not late, whatever its date says, and reporting a published post
 * as three days overdue is how a red number stops meaning anything.
 */
export function dueBucketOf(item: HeldItem, todayKey: string, weekEndKey: string): DueBucket {
  if (isFinished(item)) return 'none'
  const due = item.due_date
  if (!due) return 'none'
  if (due < todayKey) return 'overdue'
  if (due === todayKey) return 'today'
  return due <= weekEndKey ? 'week' : 'later'
}

export type DueSplit = {
  /** past their date and still someone's move */
  overdue: HeldItem[]
  /** due on the person's own today */
  today: HeldItem[]
  /** due today or later this week — `today` is INCLUDED, because "what is on
   *  this week" is the question, and excluding today answers a different one */
  this_week: HeldItem[]
}

/** Split a person's held items by when they are due, on their own calendar. */
export function splitDue(items: HeldItem[], todayKey: string, weekEndKey: string): DueSplit {
  const overdue: HeldItem[] = []
  const today: HeldItem[] = []
  const thisWeek: HeldItem[] = []
  for (const i of items) {
    switch (dueBucketOf(i, todayKey, weekEndKey)) {
      case 'overdue': overdue.push(i); break
      case 'today': today.push(i); thisWeek.push(i); break
      case 'week': thisWeek.push(i); break
      default: break
    }
  }
  const byDate = (a: HeldItem, b: HeldItem) => (a.due_date ?? '').localeCompare(b.due_date ?? '')
  return { overdue: overdue.sort(byDate), today: today.sort(byDate), this_week: thisWeek.sort(byDate) }
}

// ─── Holding ─────────────────────────────────────────────────────────────

/** Held items grouped by the word their stage wears — "Being revised 3". */
export function groupByStatusWord(items: HeldItem[]): { word: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const i of items) {
    if (isFinished(i)) continue
    const word = statusWordOf(i)
    counts.set(word, (counts.get(word) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
}

/**
 * A person's open items, split into what they must act on and what they are
 * waiting for somebody else to do.
 *
 * The split is `whoseTurn` — the same answer their own item page gives them,
 * so a row filed under "Your turn" here is a row with a button there.
 */
export function splitByTurn(
  items: HeldItem[], person: { id: string; role: Role },
): { mine: HeldItem[]; waiting: HeldItem[] } {
  const mine: HeldItem[] = []
  const waiting: HeldItem[] = []
  for (const i of items) {
    if (isFinished(i)) continue
    const turn = whoseTurn(i.status, i as ActingItem, person, turnsFor(overlayOf(i)))
    ;(turn.mine ? mine : waiting).push(i)
  }
  const byDate = (a: HeldItem, b: HeldItem) =>
    (a.due_date ?? '9999-99-99').localeCompare(b.due_date ?? '9999-99-99')
  return { mine: mine.sort(byDate), waiting: waiting.sort(byDate) }
}

// ─── Throughput ──────────────────────────────────────────────────────────

export type Throughput = {
  versions: number
  submitted: number
  approved: number
  scheduled: number
  posted: number
}

export const EMPTY_THROUGHPUT: Throughput = {
  versions: 0, submitted: 0, approved: 0, scheduled: 0, posted: 0,
}

/** The five things a week of production work actually produces, counted from
 *  the audit trail rather than from the items' current state — state tells you
 *  where work IS, the trail tells you who moved it there. */
export function summariseThroughput(rows: ActivityRow[]): Throughput {
  const out = { ...EMPTY_THROUGHPUT }
  for (const r of rows ?? []) {
    if (r.action === 'version_added') { out.versions += 1; continue }
    if (r.action !== 'status_change') continue
    switch (r.new_value) {
      case 'internal_review': out.submitted += 1; break
      case 'approved_for_scheduling': out.approved += 1; break
      case 'scheduled': out.scheduled += 1; break
      case 'published': out.posted += 1; break
      default: break
    }
  }
  return out
}

/** The biggest single bar in a throughput figure — what the mini-bars scale to. */
export function throughputPeak(t: Throughput): number {
  return Math.max(t.versions, t.submitted, t.approved, t.scheduled, t.posted, 1)
}

/** Fourteen days of "did anything happen", one count per day in `tz`. */
export function sparkline(
  rows: ActivityRow[], now: Date, days = 14, tz: string = AGENCY_TZ,
): { day: string; count: number }[] {
  const keys = recentDayKeys(now, days, tz)
  const counts = new Map(keys.map(k => [k, 0]))
  for (const r of rows ?? []) {
    const k = dayKeyInZone(r.created_at, tz)
    if (k !== null && counts.has(k)) counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  return keys.map(day => ({ day, count: counts.get(day) ?? 0 }))
}

// ─── The row ─────────────────────────────────────────────────────────────

/** One person, decided — the shape the table renders and the API returns. */
export type TeamActivityRow = {
  id: string
  name: string
  email: string
  role: Role
  timezone: string
  /** the latest thing they did, from the audit trail — null = nothing yet */
  last_active: string | null
  holding: {
    total: number
    items: number
    shoots: number
    scheduling: number
    comments: number
    by_status: { word: string; count: number }[]
  }
  due: { overdue: number; today: number; this_week: number }
  throughput: Throughput
  activity: { day: string; count: number }[]
  /** the open items themselves, so the expanded panel needs no second request */
  items: HeldItem[]
}

/** How the table is ordered. Overdue first is triage; holding is workload. */
export type SortKey = 'overdue' | 'holding' | 'name'

export function sortRows(rows: TeamActivityRow[], key: SortKey): TeamActivityRow[] {
  const byName = (a: TeamActivityRow, b: TeamActivityRow) =>
    (a.name || a.email).localeCompare(b.name || b.email)
  return [...rows].sort((a, b) => {
    if (key === 'overdue') return b.due.overdue - a.due.overdue || b.holding.total - a.holding.total || byName(a, b)
    if (key === 'holding') return b.holding.total - a.holding.total || b.due.overdue - a.due.overdue || byName(a, b)
    return byName(a, b)
  })
}

/** The three people a manager should chase first — the Overview's Team card. */
export function topOverdue(rows: TeamActivityRow[], n = 3): TeamActivityRow[] {
  return sortRows(rows.filter(r => r.due.overdue > 0), 'overdue').slice(0, n)
}

/** "2 h ago", in the VIEWER's terms — an elapsed time needs no zone, and a
 *  date does, so the fallback hands the caller a day key to format. */
export function sinceLabel(
  iso: string | null | undefined, now: Date, tz: string = AGENCY_TZ,
): string {
  if (!iso) return 'never'
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return 'never'
  const mins = Math.floor((now.getTime() - then) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.floor(hours / 24)
  if (days < 14) return `${days} d ago`
  return dayKeyInZone(iso, tz) ?? 'never'
}
