/**
 * Pure shoot-lifecycle derivation — no I/O.
 *
 * The manual "Lock date → Mark as shot → Wrapped" chain asked people to press
 * three buttons to record things that mostly follow from the calendar. What a
 * normal user needs is ONE action — "Book the shoot", once the plan is
 * approved — and after the shoot date passes, the shoot simply IS shot; no
 * button says so.
 *
 * The data model is untouched: batches still hold brief/locked/shot/wrapped
 * (batch-brief-core), and every gate that reads those statuses keeps working.
 * This file only derives what a SURFACE should say and when the app may move
 * the status by itself.
 */

import type { BatchStatus } from './batch-brief-core'

/** What a shoot card or page should SAY, derived from status + calendar. */
export type ShownShootState = 'planning' | 'booked' | 'shot' | 'closed'

const dayOf = (d: Date) => d.toISOString().slice(0, 10)

/**
 * A locked shoot whose date has passed reads as "Shot" — nobody has to press
 * a button the morning after. The stored status may still say 'locked'; the
 * screen says what actually happened. Same-day is still "booked": the crew
 * may be mid-shoot.
 */
export function shownShootState(
  b: { status: BatchStatus; shoot_date?: string | null },
  today: Date = new Date(),
): ShownShootState {
  if (b.status === 'wrapped') return 'closed'
  if (b.status === 'shot') return 'shot'
  if (b.status === 'locked') {
    return b.shoot_date && b.shoot_date < dayOf(today) ? 'shot' : 'booked'
  }
  return 'planning'
}

/** The words for those states, shared by every card and chip. */
export const SHOWN_SHOOT_LABEL: Record<ShownShootState, string> = {
  planning: 'In planning',
  booked: 'Booked',
  shot: 'Shot',
  closed: 'Closed',
}

/**
 * May this shoot close itself?
 *
 * A shoot auto-wraps when every piece it produced has been published — there
 * is nothing left for anyone to do, so nobody should have to remember a
 * "Wrapped" button. The shoot's own plan is paperwork, not a deliverable, and
 * never counts; a shoot that produced nothing never auto-wraps (it may still
 * be waiting for its items), and one still in planning has nothing to close.
 */
export function shouldAutoWrap(
  batchStatus: BatchStatus,
  items: { status: string; work_kinds?: { slug?: string } | null }[],
): boolean {
  if (batchStatus !== 'locked' && batchStatus !== 'shot') return false
  const produced = items.filter(i => i.work_kinds?.slug !== 'shoot_brief')
  return produced.length > 0 && produced.every(i => i.status === 'published')
}
