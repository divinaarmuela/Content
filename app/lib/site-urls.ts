/**
 * The two hosts this app answers on, and which one a link belongs to.
 *
 * One Vercel project serves both the marketing site and the signed-in app.
 * A link sent to a CUSTOMER must be the public host — app.mdmmarketing.com.au
 * is where staff sign in, and putting it in a booking confirmation both looks
 * wrong and invites people toward a login they do not have. A link for the
 * TEAM (open the bookings page) is the app host.
 *
 * No I/O and no server-only import: the dashboard needs `publicUrl` too, for
 * the share links it puts on the clipboard.
 */

/** Where customers go: the marketing site. */
export const PUBLIC_SITE =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') || 'https://www.mdmmarketing.com.au'

/** Where staff go: the signed-in app. */
export const APP_SITE =
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || 'https://app.mdmmarketing.com.au'

/** A customer-facing URL — booking links, manage links, anything shared. */
export const publicUrl = (path: string) => `${PUBLIC_SITE}${path.startsWith('/') ? path : `/${path}`}`

/** A staff-facing URL — dashboard deep links inside notification emails. */
export const appUrl = (path: string) => `${APP_SITE}${path.startsWith('/') ? path : `/${path}`}`

/** The one link that shows everything bookable. */
export const bookingIndexUrl = () => publicUrl('/book')

/** The share link for a single service. */
export const bookingUrl = (slug: string) => publicUrl(`/book/${slug}`)
