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
