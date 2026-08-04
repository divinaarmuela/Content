import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

// The public marketing site (/, /content, /marketing, /podcast-studio, /branding,
// /personal-brand, /work …) must stay open to everyone. Only the authenticated app
// shell and admin endpoints are gated, so we protect a small explicit list and treat
// everything else as public.
const isProtectedRoute = createRouteMatcher([
  '/dashboard(.*)',
  '/client(.*)',
  '/api/db-tables(.*)',
  '/api/website(.*)',
  '/api/leads(.*)',
  '/api/team(.*)',
  '/api/production(.*)',
])

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    await auth.protect()
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
    '/api/db-tables/:path*',
    '/api/ingest/:path*',
    '/api/leads/:path*',
    '/api/portal/:path*',
    '/api/production/:path*',
    '/api/reports/:path*',
    '/api/social/:path*',
    '/api/team/:path*',
    '/api/website/:path*',
    '/__clerk/:path*',
  ],
}
