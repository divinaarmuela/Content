/**
 * Pure calendar-availability core — no imports, no I/O, fully unit-testable.
 * Owns week math, event bucketing and per-calendar colour assignment. The
 * server layer (gcal.ts) fetches from Google; nothing here touches a network.
 */

export type CalEvent = {
  calendar: string          // which account it came from
  title: string
  start: string             // ISO instant, or YYYY-MM-DD for all-day
  end: string
  allDay: boolean
}

/** The dashboard plans Melbourne shoots on Melbourne days. */
export const CAL_TZ = 'Australia/Melbourne'

/** YYYY-MM-DD for an instant, in a timezone. en-CA is the locale whose date
 *  format IS the key format — no reassembly, no UTC drift. */
export function dayKey(isoInstant: string, tz: string = CAL_TZ): string {
  return new Date(isoInstant).toLocaleDateString('en-CA', { timeZone: tz })
}

/** Monday-start week containing `key` (YYYY-MM-DD), as 7 day keys.
 *  Pure calendar arithmetic on the date parts — timezone-free by design,
 *  because a day key has no timezone. */
export function weekOf(key: string): string[] {
  const [y, m, d] = key.split('-').map(Number)
  const base = new Date(Date.UTC(y, m - 1, d))
  const dow = (base.getUTCDay() + 6) % 7 // Mon=0 … Sun=6
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(Date.UTC(y, m - 1, d - dow + i))
    return day.toISOString().slice(0, 10)
  })
}

/** The same week shifted by n weeks (n may be negative). */
export function shiftWeek(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n * 7)).toISOString().slice(0, 10)
}

/**
 * Bucket events into the given day keys.
 *
 * A timed event lands on the day it STARTS (a 7pm shoot that runs past
 * midnight is planned as that evening's job). An all-day event lands on every
 * day it covers — Google's all-day `end` date is exclusive, so a one-day event
 * ends "tomorrow" and must not bleed onto it.
 */
export function bucketByDay(events: CalEvent[], days: string[], tz: string = CAL_TZ): Map<string, CalEvent[]> {
  const wanted = new Set(days)
  const out = new Map<string, CalEvent[]>(days.map(d => [d, []]))

  for (const e of events) {
    if (e.allDay) {
      for (let k = e.start; k < e.end; k = shiftDay(k, 1)) {
        if (wanted.has(k)) out.get(k)!.push(e)
      }
    } else {
      const k = dayKey(e.start, tz)
      if (wanted.has(k)) out.get(k)!.push(e)
    }
  }

  for (const list of out.values()) {
    list.sort((a, b) =>
      (a.allDay === b.allDay ? 0 : a.allDay ? -1 : 1) || a.start.localeCompare(b.start))
  }
  return out
}

function shiftDay(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/** Stable colour per calendar: by sorted position, so every viewer sees the
 *  same calendar in the same colour regardless of connect order. */
const PALETTE = ['#2563eb', '#d97706', '#059669', '#dc2626', '#7c3aed', '#0891b2'] as const

export function calendarColors(emails: string[]): Record<string, string> {
  const sorted = [...new Set(emails)].sort()
  return Object.fromEntries(sorted.map((e, i) => [e, PALETTE[i % PALETTE.length]]))
}
