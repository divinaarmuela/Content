/**
 * POST APPROVAL'S CALENDAR, the pure half (the owner, 13 Nov 2026: "the calendar in post approval is broken, we need
 * to redesign this to look like the one in social schedule"). One tile is one POST, on the day its audience sees it
 * (the client's zone), with every network on it — the old calendar drew one line per network, so a post going to
 * three networks was three lines. No I/O.
 */

const DAY_MS = 24 * 60 * 60_000
const pad = (n: number) => String(n).padStart(2, '0')
const utcOf = (key: string): number => { const [y, m, d] = key.split('-').map(Number); return Date.UTC(y, m - 1, d) }
const keyOf = (ms: number): string => { const d = new Date(ms); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` }

/** is this a day key, 'YYYY-MM-DD'? */
export const isDayKey = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(utcOf(v))

/** a day key moved by whole days */
export function shiftDay(key: string, days: number): string {
  return keyOf(utcOf(key) + days * DAY_MS)
}

/** the Monday-to-Sunday week a day sits in */
export function weekKeys(key: string): string[] {
  const start = utcOf(key) - ((new Date(utcOf(key)).getUTCDay() + 6) % 7) * DAY_MS
  return Array.from({ length: 7 }, (_, i) => keyOf(start + i * DAY_MS))
}

/** 'YYYY-MM' of a day */
export const monthOfDay = (key: string): string => key.slice(0, 7)

/** the same day of the month before or after, held inside that month (31 Jan → 28 Feb) */
export function shiftMonthDay(key: string, months: number): string {
  const [y, m, d] = key.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1 + months, 1))
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  return `${first.getUTCFullYear()}-${pad(first.getUTCMonth() + 1)}-${pad(Math.min(d, last))}`
}

/** "November 2026", or "9 – 15 Nov 2026" for a week */
export function rangeWords(range: 'month' | 'week', cursor: string): string {
  const fmt = (key: string, o: Intl.DateTimeFormatOptions) => new Date(utcOf(key)).toLocaleDateString('en-AU', { timeZone: 'UTC', ...o })
  if (range === 'month') return fmt(cursor, { month: 'long', year: 'numeric' })
  const w = weekKeys(cursor)
  const sameMonth = w[0].slice(0, 7) === w[6].slice(0, 7)
  return `${fmt(w[0], sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'short' })} – ${fmt(w[6], { day: 'numeric', month: 'short', year: 'numeric' })}`
}

/** "Monday 9 November 2026" */
export function dayWords(key: string): string {
  return new Date(utcOf(key)).toLocaleDateString('en-AU', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

/**
 * Posts onto their days, earliest first within a day. `dayOf` turns a post into its day key in its own client's zone
 * (or null when it has no time): the calendar never guesses a day.
 */
export function groupByDay<T>(posts: readonly T[], dayOf: (post: T) => string | null, at: (post: T) => string): Map<string, T[]> {
  const by = new Map<string, T[]>()
  for (const p of posts) {
    const key = dayOf(p)
    if (!key) continue
    const list = by.get(key); if (list) list.push(p); else by.set(key, [p])
  }
  for (const list of by.values()) list.sort((a, b) => at(a).localeCompare(at(b)))
  return by
}

/** how many of a busy day's posts a month cell draws before "+N more" (a week draws them all) */
export const MONTH_CELL_MAX = 4
