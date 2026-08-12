import { redirect } from 'next/navigation'

/** The calendar is now a view inside the scheduler — the same data at a
 *  different zoom level. Kept as a redirect so existing links and bookmarks
 *  still land somewhere sensible. */
export default function CalendarPage() {
  redirect('/dashboard/scheduler/calendar')
}
