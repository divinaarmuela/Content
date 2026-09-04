/**
 * MOVING A POST WITH YOUR HANDS — the arithmetic, with no calendar around it.
 *
 * Dragging is the one part of the Schedule that feels like an app rather than
 * a form, and it is also the part where a mistake is expensive: a post that
 * lands an hour out because a pixel was rounded the wrong way goes out at the
 * wrong time to a real audience. So every decision a drag makes lives here,
 * pure and tested:
 *
 *   - where a half-dragged tile SNAPS to (the quarter hour, like a click),
 *   - what the arrow keys do for somebody who cannot drag at all,
 *   - what the floating label under the pointer SAYS,
 *   - what moving a tile to another day in Month view means (same time of
 *     day, different date — never midnight),
 *   - what order the Preview grid puts a feed in.
 *
 * Nothing in this file touches the DOM, a listener or a network. The hook
 * (`useDragSchedule`) does the hands; this does the thinking.
 */

import { canReschedule, type SchedulePost } from './social-schedule-core'
import { formatInZone, fromZonedInput, safeZone, wallTimeIn } from './timezone-core'

/** Times land on the quarter hour. Nobody means 6:07, and the week grid reads
 *  clicks back the same way (`scheduleWeekGrid.slotAt`), so a drop and a click
 *  on the same pixel mean the same minute. */
export const SNAP_MINUTES = 15

/** One press of an arrow key: half an hour up or down, a whole day sideways.
 *  Fifteen minutes a press would be four presses per hour — a keyboard has to
 *  cross a week without wearing anybody out. */
export const KEY_STEP_MINUTES = 30

/** How long a finger has to rest on a tile before it lifts. Under ~300ms the
 *  page cannot be scrolled past a tile without picking it up; over ~500ms it
 *  feels broken. */
export const LONG_PRESS_MS = 400

const pad = (n: number) => String(n).padStart(2, '0')

/** Round minutes-past-midnight to the nearest step. */
export function snapToStep(minutes: number, step: number = SNAP_MINUTES): number {
  if (!Number.isFinite(minutes)) return 0
  const size = Number.isFinite(step) && step > 0 ? step : SNAP_MINUTES
  return Math.round(minutes / size) * size
}

/**
 * The label that follows the tile: "Drop · 2:00 pm".
 *
 * The word is "Drop" and not "Move to" because it is on the thing under the
 * pointer, describing what letting go would do.
 */
export function dropLabel(time: string | null | undefined): string {
  const when = String(time ?? '').trim()
  return when ? `Drop · ${when}` : 'Drop here'
}

/** The same label, read off an instant rather than a slot. */
export function dropLabelAt(iso: string | null | undefined, tz: string): string {
  return dropLabel(iso ? formatInZone(iso, tz, 'time') : null)
}

export type MoveKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'

const KEY_DELTA: Record<MoveKey, { minutes: number; days: number }> = {
  ArrowUp: { minutes: -KEY_STEP_MINUTES, days: 0 },
  ArrowDown: { minutes: KEY_STEP_MINUTES, days: 0 },
  ArrowLeft: { minutes: 0, days: -1 },
  ArrowRight: { minutes: 0, days: 1 },
}

export function isMoveKey(key: string): key is MoveKey {
  return key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight'
}

/**
 * One arrow press, in the CLIENT's zone.
 *
 * Worked on the wall clock and not on the instant: "same time tomorrow" has
 * to stay 2 pm across the weekend the clocks change, which adding 86,400,000
 * milliseconds does not do. The date is stepped as a calendar date and the
 * time is re-attached to it, so a day is a day and half an hour is half an
 * hour, whatever the offset did in between.
 */
export function keyboardMove(
  iso: string | null | undefined,
  key: string,
  tz: string,
): string | null {
  if (!isMoveKey(key)) return null
  const zone = safeZone(tz)
  const wall = iso ? wallTimeIn(iso, zone) : null
  if (!wall) return null
  const delta = KEY_DELTA[key]

  // step the wall clock, carrying whole days out of the minutes
  let minutes = wall.hour * 60 + wall.minute + delta.minutes
  let dayShift = delta.days
  while (minutes < 0) { minutes += 1440; dayShift -= 1 }
  while (minutes >= 1440) { minutes -= 1440; dayShift += 1 }

  // the DATE is stepped in UTC on a plain calendar date — a wall calendar has
  // no offsets on it, which is exactly why it can be stepped safely
  const date = new Date(Date.UTC(wall.year, wall.month - 1, wall.day) + dayShift * 86_400_000)
  const dayKey = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
  const snapped = snapToStep(minutes)
  const hour = Math.floor(snapped / 60) % 24
  const minute = snapped % 60
  return fromZonedInput(`${dayKey}T${pad(hour)}:${pad(minute)}`, zone)
}

/**
 * A tile dropped on another day in Month view.
 *
 * Month cells have no hours in them, so the only honest answer is "the same
 * time, on that day". Dropping a 6 pm post on Friday must not quietly turn it
 * into a midnight post; if the post has no time yet, `fallbackTime` (the
 * client's usual posting time) fills it in.
 */
export function moveToDay(
  iso: string | null | undefined,
  dayKey: string,
  tz: string,
  fallbackTime = '11:00',
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dayKey ?? '').trim())) return null
  const zone = safeZone(tz)
  const wall = iso ? wallTimeIn(iso, zone) : null
  const clock = wall
    ? `${pad(wall.hour)}:${pad(wall.minute)}`
    : (/^\d{2}:\d{2}$/.test(fallbackTime) ? fallbackTime : '11:00')
  return fromZonedInput(`${dayKey.trim()}T${clock}`, zone)
}

/**
 * May this tile be picked up at all, and if not, why?
 *
 * The same rule the server enforces (`canReschedule`), asked before the drag
 * starts so a finished post simply does not lift — a tile that follows the
 * pointer for a second and then snaps back with a refusal is a worse way of
 * saying the same thing.
 */
export function dragBlockReason(post: SchedulePost | null | undefined): string | null {
  const move = canReschedule(post)
  return move.ok ? null : move.reason
}

export function mayDragTile(post: SchedulePost | null | undefined): boolean {
  return dragBlockReason(post) === null
}

/** What a screen reader is told once a move lands. Full date and time: the
 *  person who just pressed Enter cannot see which column it flew to. */
export function movedAnnouncement(
  title: string | null | undefined,
  iso: string | null | undefined,
  tz: string,
): string {
  const name = String(title ?? '').trim() || 'Post'
  const when = iso ? formatInZone(iso, safeZone(tz), 'full') : null
  return when ? `${name} moved to ${when}` : `${name} moved`
}

/** What a screen reader is told while it is being moved, before Enter. */
export function movingAnnouncement(
  title: string | null | undefined,
  iso: string | null | undefined,
  tz: string,
): string {
  const name = String(title ?? '').trim() || 'Post'
  const when = iso ? formatInZone(iso, safeZone(tz), 'full') : null
  return when
    ? `${name} — ${when}. Arrow keys to move, Enter to confirm, Escape to cancel.`
    : `${name} — arrow keys to move, Enter to confirm, Escape to cancel.`
}

/* ── the feed preview ───────────────────────────────────────────────────── */

export type PreviewablePost = { scheduled_for?: string | null }

/**
 * The order the Preview grid reads in.
 *
 * The point of the grid is "what is the feed about to look like", so what has
 * not gone out yet comes first, soonest at the top left, exactly the order it
 * will appear in. What has already gone out follows, newest first, so the new
 * work can be seen against the last few posts rather than floating on its own.
 * A post with no time at all is not in a feed yet and is left out.
 */
export function previewOrder<T extends PreviewablePost>(
  posts: readonly T[],
  now: number = Date.now(),
): T[] {
  const timed = posts.filter(p => Number.isFinite(Date.parse(String(p.scheduled_for ?? ''))))
  const at = (p: T) => Date.parse(String(p.scheduled_for))
  const upcoming = timed.filter(p => at(p) >= now).sort((a, b) => at(a) - at(b))
  const past = timed.filter(p => at(p) < now).sort((a, b) => at(b) - at(a))
  return [...upcoming, ...past]
}
