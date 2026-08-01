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

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|avif|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
    '/__clerk/:path*',
  ],
}
