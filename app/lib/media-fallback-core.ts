/**
 * A STORED FILE, ASKED FOR AGAIN THROUGH OUR OWN SITE — the rules (pure; tests/media-fallback-core.test.ts).
 *
 * WHY (the owner, 27 Nov 2026: "why is abby … having broken thumbnails" — and then "we shouldnt do anything on abby
 * end it should be us"). Every picture and video the app keeps is drawn straight from storage's public address,
 * `pub-….r2.dev`. On Abby's Mac that address did not exist: her browser answered DNS_PROBE_FINISHED_NXDOMAIN for it
 * while the same files loaded everywhere else (checked: all nine files present, valid, 200 from two other machines).
 * `r2.dev` is a shared Cloudflare address that some internet providers and security filters refuse to look up — and
 * a client reading their portal behind one of those would see blank tiles and never say so.
 *
 * So the app has a second way to every stored file: `/media/<the file>` on our own site, which the site passes on to
 * storage (the rewrite in next.config.ts). Nobody who can open the dashboard can fail to reach that. A picture or
 * video that fails from storage is asked for once more from there (app/components/MediaFallback.tsx).
 *
 * ONLY WHEN THE FIRST ASK FAILS: a browser that can reach storage keeps going straight to it, so the files of
 * everybody whose internet is fine never pass through the site.
 */

/** where a stored file is reached on our own site */
export const MEDIA_PATH = '/media'

/**
 * The address on our own site for a file a page failed to draw, or null when it is not ours to retry: not in OUR
 * storage (`publicBase`, compared as a whole origin so a look-alike host is refused), or already asked for through
 * our own site. `src` is whatever the element was drawing — a storage address, or the small-copy route
 * (`/api/img?u=<storage address>`), whose answer is a redirect to storage and so fails the same way; that one falls
 * back to the original picture. `pageOrigin` is the page's own origin, for reading an address written without one.
 */
export function ownAddress(src: string | null | undefined, publicBase: string | null | undefined, pageOrigin: string): string | null {
  if (!src || !publicBase) return null
  let base: URL, u: URL
  try { base = new URL(publicBase); u = new URL(src, pageOrigin) } catch { return null }
  if (base.protocol !== 'https:') return null

  // the small-copy route: the picture it was asked to shrink is the one to fall back to
  if (u.origin === pageOrigin && u.pathname === '/api/img') {
    const inner = u.searchParams.get('u')
    if (!inner) return null
    try { u = new URL(inner) } catch { return null }
  }

  if (u.protocol !== 'https:' || u.origin !== base.origin || u.username || u.password) return null
  const basePath = base.pathname.replace(/\/$/, '')
  if (basePath && !u.pathname.startsWith(`${basePath}/`)) return null
  const inside = u.pathname.slice(basePath.length)
  if (inside.length < 2) return null
  // the place in a video (`#t=0.001`) is kept; a query is not — storage does not read one
  return `${MEDIA_PATH}${inside}${u.hash}`
}

/** The rule next.config.ts hands to Next: `/media/…` is passed on to storage. Null when there is no storage address. */
export function mediaRewrite(publicBase: string | null | undefined): { source: string; destination: string } | null {
  if (!publicBase) return null
  let base: URL
  try { base = new URL(publicBase) } catch { return null }
  if (base.protocol !== 'https:') return null
  return { source: `${MEDIA_PATH}/:path*`, destination: `${base.origin}${base.pathname.replace(/\/$/, '')}/:path*` }
}
