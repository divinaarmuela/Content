/**
 * THE ANALYTICS PAGE'S PERIODS (the owner, 2 Nov 2026: "for analytics page … can u do weekly?"). A week is Monday to
 * Sunday where the audience is (Melbourne), as the posting calendar counts it. Pure: today's day key in, days out.
 */

export type AnalyticsPeriod = 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'last_90' | 'last_365'

// no "all time": Zernio reads at most 366 days at once, so the longest is the last twelve months (2 Nov 2026)
export const ANALYTICS_PERIODS: readonly { key: AnalyticsPeriod; label: string }[] = [
  { key: 'this_week', label: 'This week' },
  { key: 'last_week', label: 'Last week' },
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'last_90', label: 'Last 90 days' },
  { key: 'last_365', label: 'Last 12 months' },
]

export const isPeriod = (v: unknown): v is AnalyticsPeriod => ANALYTICS_PERIODS.some(p => p.key === v)

const shift = (day: string, by: number): string => {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + by)
  return d.toISOString().slice(0, 10)
}

/** The days a period covers (YYYY-MM-DD, inclusive), from today's day key — null for a day key that is not one. */
export function periodRange(period: AnalyticsPeriod, today: string): { from: string; to: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return null
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay()
  const monday = shift(today, -((dow + 6) % 7))
  const firstOfMonth = `${today.slice(0, 7)}-01`
  switch (period) {
    case 'this_week': return { from: monday, to: today }
    case 'last_week': return { from: shift(monday, -7), to: shift(monday, -1) }
    case 'this_month': return { from: firstOfMonth, to: today }
    case 'last_month': {
      const end = shift(firstOfMonth, -1)
      return { from: `${end.slice(0, 7)}-01`, to: end }
    }
    case 'last_90': return { from: shift(today, -89), to: today }
    case 'last_365': return { from: shift(today, -364), to: today }
  }
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

/**
 * A RANGE TYPED IN (the owner, 2 Nov 2026: "make sure i can enter a custom range"). Both days YYYY-MM-DD, from no
 * later than to, to no later than today, and at most 366 days — the most Zernio reads at once. Null otherwise.
 */
export function customRange(from: string | null | undefined, to: string | null | undefined, today: string): { from: string; to: string } | null {
  const ok = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
  if (!ok(from) || !ok(to) || from > to || to > today) return null
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1
  return days <= 366 ? { from, to } : null
}
