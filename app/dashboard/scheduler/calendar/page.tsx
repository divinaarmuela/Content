import { permanentRedirect } from 'next/navigation'
import { scheduleViewHref } from '../../../lib/schedule-page-core'
import { queryOf, type IncomingParams } from '../redirect-query'

/**
 * The Scheduler's posting calendar is the Schedule page's Calendar view.
 *
 * Permanent, and the query string comes along: `?client=` and `?item=` are how
 * the bell and the "approve this post" email open the composer on one piece.
 */
export default async function SchedulerCalendarRedirect(
  { searchParams }: { searchParams: Promise<IncomingParams> },
) {
  permanentRedirect(scheduleViewHref('calendar', await queryOf(searchParams)))
}
