import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { attachedEnquiry, leadBusinessName, WROTE_AGAIN, wroteAgainPatch } from '../app/lib/lead-dedupe-core'

/** ONE SENDER, ONE LEAD (the owner, 23 Sep 2026: "why are there duplicates … make sure this never happens"). */
describe('the business on a lead', () => {
  it('is what the classifier read, else the company domain, never a free-mail domain', () => {
    expect(leadBusinessName('Australian Venue Co', 'lucy@ausvenueco.com.au')).toBe('Australian Venue Co')
    expect(leadBusinessName('', 'lucy@ausvenueco.com.au')).toBe('ausvenueco.com.au')
    expect(leadBusinessName(null, 'violetta@outlook.com.au')).toBe('')
    expect(leadBusinessName(null, 'x@gmail.com')).toBe('')
  })
})

describe('a sender who writes again', () => {
  it('lands on their lead: the new enquiry under a date, and the card asks for a reply', () => {
    const p = wroteAgainPatch({ need: 'Capture the NFL activation event' }, 'Quarterhouse photography for the AFL', '2026-09-22T00:10:00.000Z', '22 Sep 2026')
    expect(p).toEqual({ need: 'Capture the NFL activation event\n\n22 Sep 2026: Quarterhouse photography for the AFL', next_action: WROTE_AGAIN, next_action_at: '2026-09-22T00:10:00.000Z' })
    expect(attachedEnquiry('', 'first words', 'x')).toBe('first words')
    expect(attachedEnquiry('kept', '', 'x')).toBe('kept')
    expect(attachedEnquiry('a'.repeat(3990), 'the newest words', 'today').endsWith('today: the newest words')).toBe(true)
  })
  it('the scanner never makes a second lead for a sender, however long ago the first was', () => {
    const s = readFileSync('app/lib/email-lead.ts', 'utf8')
    expect(s).toContain("where: l => l.email?.toLowerCase() === sender,")
    expect(s).not.toContain('duplicate_window_days * 24 * 3600 * 1000')
    expect(s).toContain("status: 'attached', is_lead: true, confidence: c.confidence,")
    expect(s).toContain("outcome: 'attached_to_lead',")
    expect(s).toContain('biz: leadBusinessName(c.business, msg.fromEmail),')
    expect(readFileSync('app/dashboard/settings/ScannerSettings.tsx', 'utf8')).toContain('no longer used: one sender is one lead, always')
    expect(readFileSync('app/lib/acq-scanning-core.ts', 'utf8')).toContain("attached: 'Added to their existing lead',")
  })
})
