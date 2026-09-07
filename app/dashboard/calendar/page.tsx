import { permanentRedirect } from 'next/navigation'
import { scheduleViewHref } from '../../lib/schedule-page-core'

/** "Calendar" meant three different things. This one is the posting calendar,
 *  which is the Schedule page's Calendar view — kept as a permanent redirect
 *  so existing links and bookmarks still land on it. */
export default function CalendarPage() {
  permanentRedirect(scheduleViewHref('calendar'))
}
