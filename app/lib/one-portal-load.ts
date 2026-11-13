import 'server-only'
import { withRequestCache } from '@/lib/db'
import { loadOnePortal } from './one-portal-page'
import { loadScheduling } from './one-portal-schedule'
import { loadPortalForms } from './one-portal-forms'

/**
 * EVERYTHING THE ONE PORTAL PAGE READS, IN ONE REQUEST (the owner, 13 Nov 2026: "why so slow these portal, is there
 * a way to make it faster"). The page used to call the three loaders one after another, outside any request cache, so
 * tables two of them needed were downloaded again. Here they share one cache (one copy of each table per page view)
 * and the scheduling and the forms, which do not need each other, are read at the same time.
 *
 * `withFeeds`: the posted feeds are read only when the Scheduling tab is the one being opened.
 */
export async function loadOnePortalAll(rawToken: string, withFeeds: boolean) {
  return withRequestCache(async () => {
    const page = await loadOnePortal(rawToken)
    if (!page) return null
    const [profiles, forms] = await Promise.all([
      // the booked posts always (the tab's badge); the posted feeds only when the Scheduling tab is open
      loadScheduling(page.client.id, page.scope, page.data.client.timezone, new Date(), withFeeds),
      // THE FORMS (2 Oct 2026: "all this links should redirect to their one portal"): intake forms, monthly updates
      // and shoot-date proposals are rows on the Shoot brief tab; the business's only, never on a person's portal
      loadPortalForms(page.client.id, page.scope, page.data.client.timezone || 'Australia/Melbourne'),
    ])
    return { page, profiles, forms }
  })
}
