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

/** visit tags win over the link's defaults; a non-Calendly or broken href comes back untouched */
export function withUtm(href: string, utm: Utm): string {
  if (!Object.keys(utm).length) return href
  let u: URL
  try { u = new URL(href) } catch { return href }
  if (u.hostname !== 'calendly.com' && !u.hostname.endsWith('.calendly.com')) return href
  for (const k of UTM_KEYS) if (utm[k]) u.searchParams.set(k, utm[k]!)
  return u.toString()
}

/** the visit's tags as stored by UtmPassthrough, for the contact forms to send with the enquiry */
export function visitUtm(): Utm {
  try { return { ...(JSON.parse(sessionStorage.getItem('mdm_utm') || '{}') as Utm), ...utmFrom(window.location.search) } } catch { return {} }
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
