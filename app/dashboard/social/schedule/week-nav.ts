/**
 * Paging through weeks, and naming the one you are on.
 *
 * Pure, and stepped in UTC on the day KEY rather than on an instant — the
 * same discipline `scheduleWeekGrid` uses, so "next week" is seven days even
 * across the weekend the clocks change, and never six or eight.
 */

const DAY_MS = 86_400_000
const pad = (n: number) => String(n).padStart(2, '0')

export function dayKeyOfUtc(ms: number): string {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** `shiftDays('2026-09-07', 7)` → '2026-09-14'. */
export function shiftDays(key: string, days: number): string {
  const base = Date.parse(`${key}T00:00:00Z`)
  return Number.isFinite(base) ? dayKeyOfUtc(base + days * DAY_MS) : key
}

export type LabelDay = { day: number; month: number; year: number }

/**
 * "7 – 13 September 2026" — and the longer forms a week that crosses a month
 * or a year needs, because "7 – 3 September" is not a week anybody can read.
 */
export function rangeLabel(days: readonly LabelDay[]): string {
  if (days.length === 0) return ''
  const a = days[0]
  const b = days[days.length - 1]
  const month = (m: number, y: number) =>
    new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-AU', { timeZone: 'UTC', month: 'long' })
  if (a.year !== b.year) {
    return `${a.day} ${month(a.month, a.year)} ${a.year} – ${b.day} ${month(b.month, b.year)} ${b.year}`
  }
  if (a.month !== b.month) {
    return `${a.day} ${month(a.month, a.year)} – ${b.day} ${month(b.month, b.year)} ${b.year}`
  }
  return `${a.day} – ${b.day} ${month(b.month, b.year)} ${b.year}`
}

/* ── two posts at the same time ─────────────────────────────────────────── */

export type LaneItem = { id: string; top: number }
export type LanePlacement = { id: string; lane: number; lanes: number }
export type LaneOverflow = { top: number; count: number }

/**
 * Where overlapping tiles sit, side by side.
 *
 * A client posting to Instagram and TikTok at 12:00 on Wednesday is two
 * posts, not an edge case — stacked at the same `top` the second one is
 * invisible and unclickable. Overlapping tiles share the column instead: up
 * to `maxLanes` of them side by side, and anything past that is counted so
 * the day can say "+2 more" rather than swallowing them.
 *
 * Pure: it takes tops and gives back lanes, so the rule can be tested without
 * a calendar around it.
 */
export function layoutLanes(
  items: readonly LaneItem[],
  tileHeight = 80,
  maxLanes = 3,
): { placed: LanePlacement[]; overflow: LaneOverflow[] } {
  const sorted = [...items].sort((a, b) => a.top - b.top || a.id.localeCompare(b.id))
  const placed: LanePlacement[] = []
  const overflow: LaneOverflow[] = []

  let cluster: LaneItem[] = []
  const flush = () => {
    if (cluster.length === 0) return
    // first fit: a tile takes the first lane whose last tile has finished
    const laneEnds: number[] = []
    const lanes: number[] = []
    for (const item of cluster) {
      let lane = laneEnds.findIndex(end => end <= item.top)
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(0) }
      laneEnds[lane] = item.top + tileHeight
      lanes.push(lane)
    }
    const used = Math.min(Math.max(...lanes) + 1, maxLanes)
    let hidden = 0
    cluster.forEach((item, i) => {
      if (lanes[i] >= maxLanes) { hidden++; return }
      placed.push({ id: item.id, lane: lanes[i], lanes: used })
    })
    if (hidden > 0) overflow.push({ top: cluster[0].top, count: hidden })
    cluster = []
  }

  let clusterEnd = -Infinity
  for (const item of sorted) {
    if (cluster.length > 0 && item.top >= clusterEnd) flush()
    cluster.push(item)
    clusterEnd = Math.max(clusterEnd, item.top + tileHeight)
  }
  flush()
  return { placed, overflow }
}

/* ── paging by month ────────────────────────────────────────────────────── */

/** `shiftMonths('2026-09-30', -1)` → '2026-08-30'; the end of a short month
 *  clamps rather than rolling into the next one. */
export function shiftMonths(key: string, months: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!m) return key
  const [, y, mo, d] = m
  const target = new Date(Date.UTC(Number(y), Number(mo) - 1 + months, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  const day = Math.min(Number(d), lastDay)
  return `${target.getUTCFullYear()}-${pad(target.getUTCMonth() + 1)}-${pad(day)}`
}

/** "September 2026" — what the date bar says in Month view. */
export function monthLabel(key: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(key)
  if (!m) return ''
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1))
    .toLocaleDateString('en-AU', { timeZone: 'UTC', month: 'long', year: 'numeric' })
}
