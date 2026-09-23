/**
 * A LEAD IS A PAGE, NOT A DRAWER — the pure half (the owner, 23 Sep 2026,
 * of the Leads page: "this page needs fixing i think drawer and all").
 *
 * The Leads page is the inbox of enquiries — the website form and the
 * mailboxes the scanner reads — and nothing else: no stages of its own,
 * because the acquisition pipeline is the one road a deal travels. Each
 * enquiry opens on its own page, /dashboard/leads/<id>, where it is read,
 * edited, answered, brought into acquisition or made a client. No I/O.
 */

import { inboundBusinessName, inboundFromWords } from './acq-inbound-core'

export type LeadLike = {
  id: string
  created_at?: string | null
  source?: string | null
  fname?: string | null
  lname?: string | null
  email?: string | null
  phone?: string | null
  biz?: string | null
  model?: string | null
  need?: string | null
  budget?: string | null
  timeline?: string | null
  next_action?: string | null
}

export const LEADS_SUMMARY = 'Every enquiry through the website form and the mailboxes the scanner reads, newest first. Open one to answer it, bring it into acquisition or make it a client.'

/** the page's address */
export const leadPath = (id: string) => `/dashboard/leads/${encodeURIComponent(id)}`

/** who wrote: their name, else the business, else the address */
export function leadName(l: Pick<LeadLike, 'fname' | 'lname' | 'biz' | 'email'>): string {
  const person = [l.fname, l.lname].map(s => String(s ?? '').trim()).filter(Boolean).join(' ')
  return person || String(l.biz ?? '').trim() || String(l.email ?? '').trim() || 'Someone'
}

/** the business on the card and the page — never a free-mail domain */
export const leadBusiness = (l: Pick<LeadLike, 'biz' | 'fname' | 'lname' | 'email'>) => inboundBusinessName(l)

/** where the enquiry came from, in words */
export const leadFromWords = (source: string | null | undefined) => inboundFromWords(source)

export type EnquiryEntry = { when: string | null; text: string }

/**
 * What they asked for, one entry per time they wrote. The scanner adds a
 * returning sender's message under its date ("22 Sep 2026: …", see
 * lead-dedupe-core); the first entry is the original enquiry.
 */
export function enquiryEntries(need: string | null | undefined): EnquiryEntry[] {
  const text = String(need ?? '').trim()
  if (!text) return []
  const parts = text.split(/\n\n(?=\d{1,2} [A-Z][a-z]{2} \d{4}: )/)
  return parts.map((p, i) => {
    const m = i === 0 ? null : /^(\d{1,2} [A-Z][a-z]{2} \d{4}): ([\s\S]*)$/.exec(p)
    return m ? { when: m[1], text: m[2].trim() } : { when: null, text: p.trim() }
  })
}

export type ProspectLink = { id: string; lead_id?: string | null; email?: string | null; business?: string | null; stage?: string | null }

/** the prospect this lead became, if it was brought into acquisition — by the lead, or the same address */
export function prospectForLead(lead: Pick<LeadLike, 'id' | 'email'>, prospects: readonly ProspectLink[]): ProspectLink | null {
  const byLead = prospects.find(p => String(p.lead_id ?? '') === lead.id)
  if (byLead) return byLead
  const email = String(lead.email ?? '').trim().toLowerCase()
  if (!email) return null
  return prospects.find(p => String(p.email ?? '').trim().toLowerCase() === email) ?? null
}

/** the contact fields a manager may edit on the page, in the order they are drawn */
export const LEAD_FIELDS: { key: keyof LeadLike & string; label: string; long?: boolean }[] = [
  { key: 'fname', label: 'First name' },
  { key: 'lname', label: 'Last name' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'biz', label: 'Business' },
  { key: 'model', label: 'Service' },
  { key: 'budget', label: 'Budget' },
  { key: 'timeline', label: 'Timeline' },
  { key: 'need', label: 'What they need', long: true },
]

/** only the fields that changed, so a save is one small patch */
export function leadPatch(was: LeadLike, draft: Partial<LeadLike>): Record<string, string | null> {
  const patch: Record<string, string | null> = {}
  for (const f of LEAD_FIELDS) {
    if (!(f.key in draft)) continue
    const next = String(draft[f.key] ?? '').trim() || null
    const before = String(was[f.key] ?? '').trim() || null
    if (next !== before) patch[f.key] = next
  }
  return patch
}

/** the prospect page's address — the same words as acquisition.ts's prospectPath, without its server-only imports */
export const prospectPagePath = (id: string) => `/dashboard/leads/acquisition/${encodeURIComponent(id)}`
