/**
 * Pure lead-enrichment logic — no imports, unit-testable.
 * The server pipeline (lead-enrichment.ts) composes these with network/DB.
 */

export type IngestLead = {
  id?: string
  fname: string
  lname: string
  email: string
  phone: string
  biz: string
  model?: string | null
  need?: string | null
  budget?: string | null
  timeline?: string | null
}

/** Consumer/free email providers — a lead from these can't be verified as a
 *  company by domain, so it stays a lead for manual conversion. */
export const FREE_MAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'outlook.com.au', 'hotmail.com',
  'hotmail.com.au', 'live.com', 'live.com.au', 'msn.com', 'yahoo.com',
  'yahoo.com.au', 'ymail.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com',
  'proton.me', 'protonmail.com', 'pm.me', 'mail.com', 'gmx.com', 'gmx.net',
  'zoho.com', 'fastmail.com', 'hey.com', 'bigpond.com', 'bigpond.net.au',
  'optusnet.com.au', 'iinet.net.au', 'tpg.com.au', 'internode.on.net',
])

/** Lowercased domain of an email address, or null if malformed. */
export function emailDomain(email: string): string | null {
  const m = String(email ?? '').trim().toLowerCase().match(/^[^@\s]+@([^@\s]+\.[^@\s]+)$/)
  return m ? m[1] : null
}

/** A domain we can treat as a company signal (not a free-mail provider). */
export function isBusinessDomain(domain: string): boolean {
  const d = domain.trim().toLowerCase()
  return d.length > 3 && !FREE_MAIL_DOMAINS.has(d)
}

/** URL-safe slug from a business name; empty string if nothing survives. */
export function slugify(name: string): string {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

/**
 * Reduce a company name to what actually identifies it.
 *
 * "The Emerald Reception Pty Ltd", "Emerald Receptions" and "EMERALD
 * RECEPTION" are one business written three ways. Legal suffixes, a leading
 * "the", punctuation and pluralisation are noise for identity purposes, so
 * they come off before anything is compared.
 */
const LEGAL_SUFFIXES = new Set([
  'pty', 'ltd', 'limited', 'inc', 'incorporated', 'llc', 'plc', 'co',
  'company', 'corp', 'corporation', 'group', 'holdings', 'trading', 'trust',
])

export function companyKey(name: string): string {
  const words = String(name ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((w, i) => !(i === 0 && w === 'the'))
    .filter(w => !LEGAL_SUFFIXES.has(w))
    // singularise crudely: "receptions" and "reception" are the same business
    .map(w => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
  return words.join(' ')
}

/**
 * Is this plausibly the same business as one we already have?
 *
 * Deliberately conservative in one direction and generous in the other: a
 * missed match creates a duplicate lead someone deletes in two seconds, while
 * a false match silently swallows a real enquiry. So single-word keys must
 * match exactly, and containment only counts when the shorter key is a whole
 * multi-word prefix — "emerald" alone will not swallow "Emerald Reception",
 * but "Emerald Reception" will match "Emerald Receptions Pty Ltd".
 */
export function isSameCompany(a: string, b: string): boolean {
  const ka = companyKey(a)
  const kb = companyKey(b)
  if (!ka || !kb) return false
  if (ka === kb) return true
  // "RealDeal" and "Real Deal" are one business. Names inferred from a domain
  // arrive without spaces, which is precisely the case this is for.
  if (ka.replace(/ /g, '') === kb.replace(/ /g, '')) return true

  const ta = ka.split(' ')
  const tb = kb.split(' ')
  if (ta.length === 1 || tb.length === 1) return false

  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta]
  return short.every((w, i) => long[i] === w)
}

/** The first stored name that looks like the same business, or null. */
export function matchExistingCompany(name: string, existing: string[]): string | null {
  if (!companyKey(name)) return null
  return existing.find(e => isSameCompany(name, e)) ?? null
}
