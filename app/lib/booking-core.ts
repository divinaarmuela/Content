/**
 * Booking slot logic — pure, no I/O, fully testable (workflow-core pattern).
 * Given a resource's weekly hours, its blackouts, a service duration, and the
 * bookings already taken, produce the open start-times for a given day.
 */

export type WeeklyHours = { weekday: number; start_min: number; end_min: number }
export type SlotInput = {
  /** minutes-from-midnight windows for THIS weekday (already filtered) */
  windows: { start_min: number; end_min: number }[]
  /** service length in minutes */
  durationMin: number
  /** step between candidate starts (default = duration) */
  stepMin?: number
  /** start-times already taken, as minutes-from-midnight (local) */
  takenMins: number[]
  /** if the day is today, minutes-from-midnight now (slots before it are gone) */
  nowMin?: number
}

/** clamp + sanity so a bad row can't produce garbage slots */
const clampMin = (n: unknown) =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(1440, Math.max(0, Math.round(n))) : null

/** The open start-times (minutes from midnight) for one day. Deterministic. */
export function openSlots(input: SlotInput): number[] {
  const duration = clampMin(input.durationMin)
  if (!duration || duration <= 0) return []
  const step = clampMin(input.stepMin) || duration
  const taken = new Set(input.takenMins.map(m => clampMin(m)).filter((m): m is number => m !== null))
  const floor = input.nowMin ?? -1
  const out: number[] = []
  for (const w of input.windows) {
    const ws = clampMin(w.start_min)
    const we = clampMin(w.end_min)
    if (ws === null || we === null || we <= ws) continue
    for (let t = ws; t + duration <= we; t += step) {
      if (t <= floor) continue        // no slots in the past today
      if (taken.has(t)) continue      // already booked
      out.push(t)
    }
  }
  return [...new Set(out)].sort((a, b) => a - b)
}

/* ── timezone: local opening hours ⇄ real instants ────────────────────────
 * Availability is written in a resource's LOCAL wall-clock ("9:00 to 17:00"),
 * while a booking is a real instant (timestamptz). Melbourne moves between
 * UTC+10 and UTC+11, so converting with a fixed offset silently books people
 * an hour out for half the year. These do it against the actual zone rules.
 */

/** How far ahead of UTC `timeZone` is at that instant, in ms. */
export function tzOffsetMs(utcMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const p: Record<string, string> = {}
  for (const part of dtf.formatToParts(new Date(utcMs))) p[part.type] = part.value
  // formatToParts can render midnight as hour 24 — normalise before Date.UTC
  const asIfUtc = Date.UTC(
    Number(p.year), Number(p.month) - 1, Number(p.day),
    Number(p.hour) % 24, Number(p.minute), Number(p.second),
  )
  return asIfUtc - utcMs
}

/**
 * A local day + minutes-from-midnight → the real instant.
 *
 * Two passes: guess with the offset at the naive instant, then re-check the
 * offset at the answer. That second pass is what makes the DST changeover
 * days correct instead of an hour out.
 */
export function zonedToUtc(dayISO: string, minutes: number, timeZone: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayISO)) return null
  const naive = Date.parse(`${dayISO}T00:00:00Z`)
  if (Number.isNaN(naive)) return null
  const target = naive + minutes * 60_000
  const first = target - tzOffsetMs(target, timeZone)
  const second = target - tzOffsetMs(first, timeZone)
  return new Date(second)
}

/** The instant, as seen on a wall clock in `timeZone`. */
export function utcToZoned(date: Date, timeZone: string): { day: string; minutes: number } {
  const shifted = new Date(date.getTime() + tzOffsetMs(date.getTime(), timeZone))
  const day = shifted.toISOString().slice(0, 10)
  const minutes = shifted.getUTCHours() * 60 + shifted.getUTCMinutes()
  return { day, minutes }
}

/** Weekday (0=Sun) of a plain YYYY-MM-DD, read as a calendar date. */
export function weekdayOf(dayISO: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayISO)) return null
  const t = Date.parse(`${dayISO}T00:00:00Z`)
  return Number.isNaN(t) ? null : new Date(t).getUTCDay()
}

/** "570" → "9:30 am" (local minutes-from-midnight to a friendly label). */
export function minToLabel(min: number): string {
  const h24 = Math.floor(min / 60)
  const m = min % 60
  const ampm = h24 < 12 ? 'am' : 'pm'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

/** "9:30 am" back to 570 — the inverse, for parsing simple hour inputs. */
export function labelToMin(label: string): number | null {
  const m = /^(\d{1,2}):(\d{2})\s*(am|pm)?$/i.exec(label.trim())
  if (!m) return null
  let h = Number(m[1])
  const min = Number(m[2])
  const ap = m[3]?.toLowerCase()
  if (min > 59) return null
  if (ap === 'pm' && h < 12) h += 12
  if (ap === 'am' && h === 12) h = 0
  if (h > 23) return null
  return h * 60 + min
}
