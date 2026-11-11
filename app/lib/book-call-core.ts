import { PAGE_PARAM, UTM_KEYS, type Utm } from './utm-core'

/**
 * ONE BOOKING PAGE (11 Nov 2026, the owner: "do a revamp of call to action booking call for the md media site to one
 * dedicated booking page embedded … make it book-call"). Every "Book a call" on the site goes to /book-call on our own
 * domain, where the Calendly calendar is embedded inline, instead of sending people off to calendly.com.
 *
 * Tracking is kept exactly as before:
 *   - the page they came FROM travels as ?from=/services/strategy and reaches Calendly as salesforce_uuid
 *     (Calendly passes it to the webhook → "Booked from" on Leads)
 *   - an ad's utm_* tags (kept 30 days by UtmPassthrough) win; without an ad, the button's own tag
 *     (utm_source=website, utm_medium=book-a-call, utm_campaign=<cta>) is used, as the old links did
 * Calendly's embed docs: utm_* and salesforce_uuid may be passed in the embed URL; only those six are supported.
 */

export const BOOK_CALL_PATH = '/book-call'
export const CALENDLY_CALL_URL = 'https://calendly.com/mdmmarketing-info/10-minute-content-subscription-discovery-call-m-clone'

/** a "Book a call" link: /book-call?cta=<which button> (the page is added at click time by UtmPassthrough) */
export function bookCallHref(cta?: string): string {
  return cta ? `${BOOK_CALL_PATH}?cta=${encodeURIComponent(cta)}` : BOOK_CALL_PATH
}

/** only our own paths count as "from" (a page path, never a full URL someone typed in) */
export function cleanFrom(v: string | null | undefined): string | null {
  if (!v || !v.startsWith('/') || v.startsWith('//')) return null
  return v.slice(0, 200)
}

const clip = (v: string) => v.slice(0, 255) // Calendly: "UTM values must be 255 characters or less"

/**
 * The calendar URL the embed loads. Built by hand with encodeURIComponent (spaces as %20), NOT URLSearchParams:
 * Calendly's widget.js re-encodes the query, so URLSearchParams' "+" for a space arrived as a literal "+" —
 * checked live 11 Nov 2026, "Nov Leads" reached Calendly as "Nov+Leads", which would have put "+" in every
 * campaign / ad set / ad name on the Leads page.
 */
export function calendlyEmbedUrl(opts: { utm: Utm; from?: string | null; cta?: string | null }): string {
  const pairs: [string, string][] = []
  const hasAd = UTM_KEYS.some(k => opts.utm[k])
  if (hasAd) {
    for (const k of UTM_KEYS) if (opts.utm[k]) pairs.push([k, clip(opts.utm[k]!)])
  } else {
    pairs.push(['utm_source', 'website'], ['utm_medium', 'book-a-call'])
    if (opts.cta) pairs.push(['utm_campaign', clip(opts.cta)])
  }
  const from = cleanFrom(opts.from)
  if (from) pairs.push([PAGE_PARAM, from])
  // Calendly's own embed flag: no cookie banner inside the frame
  pairs.push(['hide_gdpr_banner', '1'])
  return `${CALENDLY_CALL_URL}?${pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`
}

/** a link to /book-call gets the page it was clicked on (once — an existing from is kept) */
export function withFrom(href: string, origin: string, page: string): string {
  let u: URL
  try { u = new URL(href, origin) } catch { return href }
  if (u.origin !== origin || u.pathname !== BOOK_CALL_PATH) return href
  if (!u.searchParams.get('from')) u.searchParams.set('from', page.slice(0, 200))
  return u.pathname + u.search
}
