/**
 * HOW LONG SOMETHING HAS WAITED, IN WORDS — pure.
 *
 * What is left of the old "waiting on a decision" list once the posting
 * rebuild (29 Sep 2026) moved every post's wait onto its own stage
 * (`post-stage-core` `waitingOn`, drawn by Post approval): `sinceWords` dates
 * a card's wait on the post board.
 *
 * No I/O, no React, no clock: `today` is passed in.
 */

import { shortDate } from './board-view-core'

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** The `YYYY-MM-DD` day of an ISO stamp, or null when it is not one. */
function dayOf(stamp: string | null | undefined): string | null {
  const day = String(stamp ?? '').slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null
}

function daysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10))
  return Math.round((b - a) / 86_400_000)
}

/**
 * "since today" · "since yesterday" · "since Tuesday" · "since 3 Sep".
 *
 * A weekday name only inside the week it still names one day: past six days
 * "Tuesday" stops meaning anything and the date says it instead. Null when
 * there is no usable stamp, so a row draws nothing rather than "since —".
 */
export function sinceWords(stamp: string | null | undefined, today: string): string | null {
  const day = dayOf(stamp)
  if (!day || !dayOf(today)) return null
  const gap = daysBetween(day, today)
  if (gap < 0) return null // dated in the future: say nothing rather than something odd
  if (gap === 0) return 'since today'
  if (gap === 1) return 'since yesterday'
  if (gap <= 6) {
    const at = new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)))
    return `since ${WEEKDAYS[at.getUTCDay()]}`
  }
  const short = shortDate(day)
  return short ? `since ${short}` : null
}
