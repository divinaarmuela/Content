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
