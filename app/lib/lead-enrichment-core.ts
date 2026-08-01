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
