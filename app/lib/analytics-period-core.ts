/**
 * THE ANALYTICS PAGE'S PERIODS (the owner, 2 Nov 2026: "for analytics page … can u do weekly?"). A week is Monday to
 * Sunday where the audience is (Melbourne), as the posting calendar counts it. Pure: today's day key in, days out.
 */

export type AnalyticsPeriod = 'this_week' | 'last_week' | 'all'

export const ANALYTICS_PERIODS: readonly { key: AnalyticsPeriod; label: string }[] = [
  { key: 'this_week', label: 'This week' },
  { key: 'last_week', label: 'Last week' },
  { key: 'all', label: 'All time' },
]

const shift = (day: string, by: number): string => {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + by)
  return d.toISOString().slice(0, 10)
}

/** The days a period covers (YYYY-MM-DD, inclusive), from today's day key — null for all time. */
export function periodRange(period: AnalyticsPeriod, today: string): { from: string; to: string } | null {
  if (period === 'all' || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay()
  const monday = shift(today, -((dow + 6) % 7))
  if (period === 'this_week') return { from: monday, to: today }
  return { from: shift(monday, -7), to: shift(monday, -1) }
}

/** "27 Oct – 2 Nov" */
export function rangeWords(r: { from: string; to: string }): string {
  const w = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  return `${w(r.from)} – ${w(r.to)}`
}

/** Is this day key inside the range? (a range of null holds everything) */
export function inRange(day: string | null | undefined, r: { from: string; to: string } | null): boolean {
  if (!r) return true
  return !!day && day >= r.from && day <= r.to
}
