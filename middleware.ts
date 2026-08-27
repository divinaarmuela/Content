import { NextResponse } from 'next/server'
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

// The public marketing site (/, /content, /marketing, /podcast-studio, /branding,
// /personal-brand, /work …) must stay open to everyone. Only the authenticated app
// shell and admin endpoints are gated, so we protect a small explicit list and treat
// everything else as public.
const isProtectedRoute = createRouteMatcher([
  '/dashboard(.*)',
  '/client(.*)',
  '/api/audience(.*)',
  '/api/db-tables(.*)',
  '/api/website(.*)',
  '/api/leads(.*)',
  '/api/team(.*)',
  '/api/production(.*)',
  '/api/overview(.*)',
  '/api/assistant(.*)',
])

/**
 * The host the signed-in app lives on, e.g. `app.mdmmarketing.com.au`.
 *
 * One Vercel project serves both the marketing site and the app, so every
 * authenticated route is reachable on BOTH hosts. Clerk's session cookie is
 * bound to one of them. Reaching /dashboard on the other host therefore means
 * a session that cannot be read — Clerk bounces to sign-in, sign-in succeeds,
 * the cookie lands on the app host, and the redirect back to the marketing
 * host cannot see it. That is the sign-in loop, and it repeats forever.
 *
 * So: if this is set, authenticated routes only exist on that host, and any
 * other host redirects there. Unset, nothing changes — which is the state
 * until the production Clerk instance is live.
 */
const APP_HOST = process.env.NEXT_PUBLIC_APP_HOST?.trim().toLowerCase()

export default clerkMiddleware(async (auth, req) => {
  if (APP_HOST) {
    const host = req.headers.get('host')?.toLowerCase().split(':')[0]
    // localhost and preview deployments are left alone: a preview URL is not
    // the app host and never will be, and redirecting it would make every
    // preview unusable
    const isLocal = host === 'localhost' || host?.endsWith('.vercel.app')
    // the portal lives on the PUBLIC host by design (its links go to clients),
    // and a fetch POST cannot follow a cross-host redirect — so its API must
    // answer wherever the portal page is. Token-authed, no Clerk cookie needed.
    const isPortalApi = req.nextUrl.pathname.startsWith('/api/portal')
    if (host && host !== APP_HOST && !isLocal && !isPortalApi) {
      const url = new URL(req.url)
      url.host = APP_HOST
      url.protocol = 'https:'
      url.port = ''
      return NextResponse.redirect(url, 308)
    }
  }

  if (isProtectedRoute(req)) {
    // auth.protect() answers a signed-out request with a hard 404, so the page
    // never admits it exists. Correct for an API, wrong for a page someone
    // sends a colleague: the link preview reads "404: This page could not be
    // found", and clicking it signed out shows the same. Pages redirect to
    // sign-in and come back afterwards; API routes keep the 404, since a
    // fetch has nowhere to send a person.
    const { userId, redirectToSignIn } = await auth()
    if (!userId) {
      if (req.nextUrl.pathname.startsWith('/api/')) { await auth.protect(); return }
      return redirectToSignIn({ returnBackUrl: req.url })
    }
  }
})

// The matcher used to be a catch-all that ran clerkMiddleware on every page,
// including the marketing homepage. Clerk syncs the session by bouncing the
// request through its Frontend API, so on the development instance visitors
// saw `…clerk.accounts.dev` flash in the address bar on `/` — on a site that
// never mounts ClerkProvider at all.
//
// So middleware now runs only where Clerk is actually needed. That is a
// superset of `isProtectedRoute`: routes like /api/social and /api/ingest are
// not force-protected here because they authorise per-handler via
// `app/lib/authz`, but `auth()` still requires the middleware to have run —
// omitting them would throw at runtime. Anything absent is genuinely
// Clerk-free: /api/submit, /api/inngest, the portal token pages, and the whole
// marketing site.
export const config = {
  matcher: [
    '/dashboard/:path*',
    '/client/:path*',
    '/sign-in/:path*',
    '/sign-up/:path*',
    '/api/assistant/:path*',
    '/api/audience/:path*',
    // the ADMIN half of bookings only: it calls auth() through requireRole,
    // which throws unless middleware ran. /api/booking/public stays absent on
    // purpose — a stranger booking a time has no Clerk session and must be
    // able to POST from the marketing host, exactly like the portal.
    '/api/booking/admin/:path*',
    '/api/clients/:path*',
    '/api/db-tables/:path*',
    // like /api/gcal: not force-protected above, because every handler calls
    // requireRole itself — but auth() needs the middleware to have run, and
    // the OAuth callback must be able to identify who came back
    '/api/dropbox/:path*',
    '/api/gcal/:path*',
    '/api/inbox/:path*',
    '/api/intake-templates/:path*',
    '/api/ingest/:path*',
    '/api/leads/:path*',
    '/api/portal/:path*',
    '/api/overview/:path*',
    '/api/production/:path*',
    '/api/reports/:path*',
    '/api/shoots/:path*',
    '/api/social/:path*',
    '/api/team/:path*',
    '/api/tracker/:path*',
    '/api/website/:path*',
    '/__clerk/:path*',
  ],
}
