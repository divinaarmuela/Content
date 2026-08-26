import { redirect } from 'next/navigation'

/** Proposals moved to Production, alongside Availability — kept as a redirect
 *  so existing links and bookmarks still land somewhere sensible. */
export default function SchedulerProposalsRedirect() {
  redirect('/dashboard/production/proposals')
}
