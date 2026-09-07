import { permanentRedirect } from 'next/navigation'
import { scheduleViewHref } from '../../lib/schedule-page-core'
import { queryOf, type IncomingParams } from './redirect-query'

/**
 * THE SCHEDULER PAGE IS GONE — its board is the Schedule page's Board view.
 *
 * Two entries for one job was the complaint ("this page will be too
 * confusing"), so the board moved to `/dashboard/social/schedule?view=board`
 * and this stays as a PERMANENT redirect. Old links, emails, bookmarks and
 * anything a person kept in a tab still land on the same board.
 *
 * The query string survives the hop: `?column=ready_to_post`, `?show=today`
 * and `?card=<id>` are all deep links the Overview and the notifications
 * write, and dropping them would land people on a board that has forgotten
 * what they were sent to look at.
 */
export default async function SchedulerBoardRedirect(
  { searchParams }: { searchParams: Promise<IncomingParams> },
) {
  permanentRedirect(scheduleViewHref('board', await queryOf(searchParams)))
}
