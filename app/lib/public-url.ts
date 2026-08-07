/**
 * Base URL for links we hand to CLIENTS — intake forms, portal share links.
 *
 * Not `window.location.origin`. The dashboard is served from the app host
 * (app.mdmmarketing.com.au), so a link copied there points a client at our
 * internal tooling domain. It works — neither /intake nor /portal is host-
 * pinned — but it is the wrong thing to put in an email to Emerald.
 *
 * NEXT_PUBLIC_SITE_URL is the public marketing domain. Falling back to the
 * current origin keeps local development and preview deployments working,
 * where a hardcoded production host would send you to the live site mid-test.
 *
 * Client-safe: no server-only imports, so the dashboard can call it directly.
 */
export function publicUrl(path: string): string {
  const base =
    process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, '')
    || (typeof window === 'undefined' ? '' : window.location.origin)
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}
