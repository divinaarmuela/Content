/**
 * BOOKINGS REPORT, the pure half (11 Nov 2026, the owner: "find out how many people have booked a call with us …
 * show a page called bookings in leads page"). Calendly's own scheduled events, all time, counted by the month they
 * were BOOKED in (created_at), so "this month" means calls booked this month, not calls happening this month.
 * The I/O half is listBookings() in calendly.ts.
 */

export type CalEvent = {
  /** Calendly event name, e.g. "Inquiry call - MD Media" */
  name: string
  status: 'active' | 'canceled'
  /** when the person booked it */
  created_at: string
  /** when the call is / was */
  start_time: string
}

export type MonthRow = { month: string; booked: number; cancelled: number }
export type BookingsReport = {
  total: number
  kept: number
  cancelled: number
  upcoming: number
  months: MonthRow[]
  types: { name: string; count: number }[]
  oldest: string | null
}

/** "2026-11" in Melbourne time, so a booking at 10 pm on the 31st lands in the right month */
export function melbourneMonth(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'unknown'
  const parts = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit' }).formatToParts(d)
  const y = parts.find(p => p.type === 'year')?.value ?? '0000'
  const m = parts.find(p => p.type === 'month')?.value ?? '00'
  return `${y}-${m}`
}

export function summariseBookings(events: CalEvent[], now = new Date()): BookingsReport {
  const byMonth = new Map<string, MonthRow>()
  const byType = new Map<string, number>()
  let cancelled = 0
  let upcoming = 0
  let oldest: string | null = null
  for (const e of events) {
    const month = melbourneMonth(e.created_at)
    const row = byMonth.get(month) ?? { month, booked: 0, cancelled: 0 }
    row.booked++
    if (e.status === 'canceled') { row.cancelled++; cancelled++ }
    else if (new Date(e.start_time).getTime() > now.getTime()) upcoming++
    byMonth.set(month, row)
    byType.set(e.name, (byType.get(e.name) ?? 0) + 1)
    if (!oldest || e.created_at < oldest) oldest = e.created_at
  }
  return {
    total: events.length,
    kept: events.length - cancelled,
    cancelled,
    upcoming,
    months: [...byMonth.values()].sort((a, b) => b.month.localeCompare(a.month)),
    types: [...byType.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    oldest,
  }
}

/** "November 2026" */
export function monthWords(month: string): string {
  const [y, m] = month.split('-').map(Number)
  if (!y || !m) return month
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}
