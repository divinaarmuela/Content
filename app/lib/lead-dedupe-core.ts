/**
 * ONE SENDER, ONE LEAD — the pure half (the owner, 23 Sep 2026: "why are
 * there duplicates … make sure this never happens").
 *
 * The email scanner used to make a second lead for a sender who wrote again
 * more than 30 days after the first time — Lucy at Australian Venue Co
 * wrote on 19 Aug and 22 Sep and got two cards. Now a sender who has ever
 * been a lead lands on that lead: the new enquiry is added to it, dated,
 * and the card asks for a reply. The business is never a free-mail domain.
 * No I/O.
 */

import { FREE_MAIL_DOMAINS } from './lead-enrichment-core'

/** the business on a new lead: what the classifier read, else the sender's company domain, never gmail.com */
export function leadBusinessName(business: string | null | undefined, email: string | null | undefined): string {
  const typed = String(business ?? '').trim()
  if (typed) return typed
  const domain = String(email ?? '').trim().toLowerCase().split('@')[1] ?? ''
  return domain && !FREE_MAIL_DOMAINS.has(domain) ? domain : ''
}

export const NEED_MAX = 4000
export const WROTE_AGAIN = 'They wrote again — reply'

/** the lead's "what they need" with the new enquiry added under a date, newest last, bounded */
export function attachedEnquiry(existing: string | null | undefined, enquiry: string | null | undefined, dateWords: string): string {
  const was = String(existing ?? '').trim()
  const now = String(enquiry ?? '').trim()
  if (!now) return was.slice(0, NEED_MAX)
  if (!was) return now.slice(0, NEED_MAX)
  const joined = `${was}\n\n${dateWords}: ${now}`
  return joined.length <= NEED_MAX ? joined : joined.slice(joined.length - NEED_MAX)
}

/** what the scanner writes on the lead when its sender writes again */
export function wroteAgainPatch(lead: { need?: string | null }, enquiry: string | null | undefined, nowIso: string, dateWords: string): Record<string, unknown> {
  return {
    need: attachedEnquiry(lead.need, enquiry, dateWords),
    next_action: WROTE_AGAIN,
    next_action_at: nowIso,
  }
}
