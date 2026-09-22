/**
 * AN INBOUND LEAD BECOMES A PROSPECT — the pure half (the acquisition
 * blueprint: "a researched business is not a lead until it replies, clicks,
 * books or submits" — an enquiry through the website form or the inbox IS
 * that signal, so it enters the system at New lead / Engaged, not as a
 * target to be researched).
 *
 * The live Leads page keeps its rows; this reads them and makes a prospect
 * from one, once, remembering which lead it came from. No I/O.
 */

import { FREE_MAIL_DOMAINS } from './lead-enrichment-core'

export type InboundLead = {
  id: string
  created_at: string
  source?: string | null
  fname?: string | null
  lname?: string | null
  email?: string | null
  phone?: string | null
  biz?: string | null
  need?: string | null
  model?: string | null
}

export type InboundCandidate = {
  lead_id: string
  business: string
  who: string | null
  email: string | null
  when: string
  from: string
  need: string | null
}

/** what the lead's source is called on the prospect */
export function inboundFromWords(source: string | null | undefined): string {
  const s = String(source ?? '')
  if (s === 'web_form') return 'Wrote in through the website form'
  if (s === 'email_ingest') return 'Emailed the agency'
  return 'Came in as a lead'
}

const domainOf = (email: string | null | undefined): string | null => {
  const d = String(email ?? '').trim().toLowerCase().split('@')[1] ?? ''
  return d && !FREE_MAIL_DOMAINS.has(d) ? d : null
}

/** the business's name: what they typed, else the person, else their company's domain */
export function inboundBusinessName(lead: Pick<InboundLead, 'biz' | 'fname' | 'lname' | 'email'>): string {
  const biz = String(lead.biz ?? '').trim()
  // the lead pipeline fills the business with the sender's domain when nothing was typed — a free-mail
  // domain is not a business (seen live: "outlook.com.au" over Violetta, 22 Sep 2026)
  if (biz && !FREE_MAIL_DOMAINS.has(biz.toLowerCase())) return biz
  const person = [lead.fname, lead.lname].map(s => String(s ?? '').trim()).filter(Boolean).join(' ')
  if (person) return person
  return domainOf(lead.email) ?? String(lead.email ?? '').trim() ?? 'Unnamed lead'
}

/** the prospect a lead becomes: a lead already, at New lead / Engaged, dated from when they wrote */
export function prospectFromLead(lead: InboundLead, now: string, byId: string): Record<string, unknown> {
  const person = [lead.fname, lead.lname].map(s => String(s ?? '').trim()).filter(Boolean).join(' ') || null
  const domain = domainOf(lead.email)
  return {
    business: inboundBusinessName(lead),
    contact_name: person,
    email: String(lead.email ?? '').trim() || null,
    phone: String(lead.phone ?? '').trim() || null,
    website: domain ? `https://${domain}` : null,
    source: 'direct',
    source_detail: inboundFromWords(lead.source),
    audit_angle: [lead.need, lead.model].map(s => String(s ?? '').trim()).filter(Boolean).join(' · ') || null,
    stage: 'engaged',
    stage_entered_at: now,
    replied_at: lead.created_at,
    owner_id: byId,
    added_by: byId,
    lead_id: lead.id,
    created_at: now,
    updated_at: now,
  }
}

/** the inbound leads not yet in the system — by the lead they came from, or the same email — newest first */
export function inboundCandidates(
  leads: readonly InboundLead[],
  prospects: readonly { lead_id?: string | null; email?: string | null }[],
): InboundCandidate[] {
  const taken = new Set(prospects.map(p => String(p.lead_id ?? '')).filter(Boolean))
  const emails = new Set(prospects.map(p => String(p.email ?? '').trim().toLowerCase()).filter(Boolean))
  return [...leads]
    .filter(l => !taken.has(l.id) && !(l.email && emails.has(String(l.email).trim().toLowerCase())))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .map(l => ({
      lead_id: l.id,
      business: inboundBusinessName(l),
      who: [l.fname, l.lname].map(s => String(s ?? '').trim()).filter(Boolean).join(' ') || null,
      email: String(l.email ?? '').trim() || null,
      when: l.created_at,
      from: inboundFromWords(l.source),
      need: String(l.need ?? '').trim() || null,
    }))
}

/** "Already in the system" — the one refusal, worded once */
export const ALREADY_A_PROSPECT = 'That lead is already in the acquisition system.'
