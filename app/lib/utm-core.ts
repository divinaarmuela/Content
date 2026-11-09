/**
 * AD TRACKING INTO CALENDLY (9 Nov 2026, owner: "i want tracking works"). An ad sends a visitor to the site with
 * utm_* tags; they may browse several pages before pressing Book a call. The tags are kept for the visit and,
 * when any calendly.com link is followed, written over the link's own default tags (utm_source=website …) so
 * Calendly — and from its webhook, the Leads page — records which ad brought the booking.
 */
export const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const
export type Utm = Partial<Record<(typeof UTM_KEYS)[number], string>>

/** the utm_* tags in a page's query string; {} when there are none */
export function utmFrom(search: string): Utm {
  const p = new URLSearchParams(search)
  const out: Utm = {}
  for (const k of UTM_KEYS) { const v = p.get(k)?.trim(); if (v) out[k] = v.slice(0, 200) }
  return out
}

/**
 * The site page the Book button was on (owner, 9 Nov 2026: "no specification which page they booked from").
 * An ad fills all five utm tags, so the page rides in salesforce_uuid — the one other link field Calendly hands back
 * untouched in the webhook's `tracking`. We do not use Salesforce.
 */
export const PAGE_PARAM = 'salesforce_uuid'

/** visit tags win over the link's defaults; the page goes in PAGE_PARAM; a non-Calendly or broken href comes back untouched */
export function withUtm(href: string, utm: Utm, page?: string): string {
  if (!Object.keys(utm).length && !page) return href
  let u: URL
  try { u = new URL(href) } catch { return href }
  if (u.hostname !== 'calendly.com' && !u.hostname.endsWith('.calendly.com')) return href
  for (const k of UTM_KEYS) if (utm[k]) u.searchParams.set(k, utm[k]!)
  if (page) u.searchParams.set(PAGE_PARAM, page.slice(0, 200))
  return u.toString()
}

const STORE = 'mdm_utm'
export const UTM_DAYS = 30

/** the newest ad's tags, kept 30 days in this browser (every tab) — a later ad click replaces them */
export function storeUtm(utm: Utm, now = Date.now()) {
  try { localStorage.setItem(STORE, JSON.stringify({ utm, at: now })) } catch {}
}
export function readStoredUtm(now = Date.now()): Utm {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) || 'null') as { utm?: Utm; at?: number } | null
    return v?.utm && typeof v.at === 'number' && now - v.at < UTM_DAYS * 864e5 ? v.utm : {}
  } catch { return {} }
}

/** the visit's tags, for the contact forms to send with the enquiry */
export function visitUtm(): Utm {
  try { return { ...readStoredUtm(), ...utmFrom(window.location.search) } } catch { return {} }
}

/** a form lead's ad fields from the tags it was sent with; {} unless an ad (not our own "website" link) brought them */
export function adFieldsFromUtm(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {}
  const u = raw as Record<string, unknown>
  const s = (k: string) => (typeof u[k] === 'string' && (u[k] as string).trim() ? (u[k] as string).trim().slice(0, 200) : null)
  const src = s('utm_source')
  if (!src || src === 'website') return {}
  const out: Record<string, string> = {}
  const set = (k: string, v: string | null) => { if (v) out[k] = v }
  set('source_tag', s('utm_campaign')); set('ad_campaign', s('utm_campaign')); set('ad_set', s('utm_term'))
  set('ad_name', s('utm_content')); set('ad_placement', s('utm_medium'))
  return out
}
