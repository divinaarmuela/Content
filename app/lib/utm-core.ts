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

/**
 * THEIR FIRST TIME HERE (owner, 9 Nov 2026: "their first time and what they have done"). Written once per browser and
 * never replaced: when, the page they landed on, the site that sent them, and the ad tags if an ad did.
 */
export type FirstVisit = { at: string; landing: string; referrer: string | null; utm: Utm }
const FIRST = 'mdm_first_visit'
export function rememberFirstVisit(v: FirstVisit) {
  try { if (!localStorage.getItem(FIRST)) localStorage.setItem(FIRST, JSON.stringify(v)) } catch {}
}
export function readFirstVisit(): FirstVisit | null {
  try { const v = JSON.parse(localStorage.getItem(FIRST) || 'null'); return v && typeof v.at === 'string' ? v as FirstVisit : null } catch { return null }
}

/** a first visit as sent by a browser → safe, short fields; null when it is not one */
export function cleanFirstVisit(raw: unknown): FirstVisit | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const s = (v: unknown, n = 300) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null)
  const at = s(r.at, 40)
  if (!at || Number.isNaN(Date.parse(at))) return null
  const landing = s(r.landing) ?? '/'
  return { at, landing: landing.startsWith('/') ? landing : '/', referrer: s(r.referrer), utm: utmFrom(new URLSearchParams(Object.entries((r.utm ?? {}) as Record<string, string>).filter(([, v]) => typeof v === 'string')).toString()) }
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
  set('source', src) // an ad's lead says Facebook / Instagram, not "Website form" (owner, 11 Nov 2026)
  set('source_tag', s('utm_campaign')); set('ad_campaign', s('utm_campaign')); set('ad_set', s('utm_term'))
  set('ad_name', s('utm_content')); set('ad_placement', s('utm_medium'))
  return out
}
