import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  LEAD_FIELDS, enquiryEntries, leadBusiness, leadFromWords, leadName, leadPatch, leadPath, prospectForLead,
} from '../app/lib/lead-page-core'

/**
 * A LEAD IS A PAGE, NOT A DRAWER; THE LEADS PAGE IS THE INBOX OF ENQUIRIES
 * (the owner, 23 Sep 2026: "this page needs fixing i think drawer and all").
 */
describe('a lead on its own page', () => {
  const lucy = { id: 'ff6fca4a', created_at: '2026-09-21T02:00:00.000Z', source: 'email_ingest', fname: 'Lucy', lname: 'Brusamarello', email: 'lucy@ausvenueco.com.au', biz: 'Australian Venue Co', need: 'Reels for three venues\n\n22 Sep 2026: Following up — any update?' }

  it('has an address, a name, a business and where it came from', () => {
    expect(leadPath('ff6fca4a')).toBe('/dashboard/leads/ff6fca4a')
    expect(leadName(lucy)).toBe('Lucy Brusamarello')
    expect(leadName({ fname: null, lname: null, biz: 'Prosmile', email: 'x@y.com' })).toBe('Prosmile')
    expect(leadBusiness(lucy)).toBe('Australian Venue Co')
    // a free-mail domain is never the business (Violetta over outlook.com.au, seen live)
    expect(leadBusiness({ biz: 'outlook.com.au', fname: 'Violetta', lname: null, email: 'v@outlook.com.au' })).toBe('Violetta')
    expect(leadFromWords('web_form')).toBe('Wrote in through the website form')
    expect(leadFromWords('email_ingest')).toBe('Emailed the agency')
  })

  it('draws every time they wrote as its own entry — the scanner adds a returning sender under a date', () => {
    expect(enquiryEntries(lucy.need)).toEqual([
      { when: null, text: 'Reels for three venues' },
      { when: '22 Sep 2026', text: 'Following up — any update?' },
    ])
    expect(enquiryEntries('')).toEqual([])
    expect(enquiryEntries('Just one line: with a colon')).toEqual([{ when: null, text: 'Just one line: with a colon' }])
  })

  it('knows the prospect a lead became — by the lead, else the same address', () => {
    expect(prospectForLead(lucy, [])).toBeNull()
    expect(prospectForLead(lucy, [{ id: 'p1', lead_id: 'ff6fca4a' }])?.id).toBe('p1')
    expect(prospectForLead(lucy, [{ id: 'p2', email: 'LUCY@ausvenueco.com.au' }])?.id).toBe('p2')
    expect(prospectForLead({ id: 'x', email: null }, [{ id: 'p2', email: '' }])).toBeNull()
  })

  it('a save is only what changed', () => {
    expect(leadPatch(lucy, {})).toEqual({})
    expect(leadPatch(lucy, { fname: 'Lucy', phone: ' 0400 000 000 ' })).toEqual({ phone: '0400 000 000' })
    expect(leadPatch(lucy, { biz: '' })).toEqual({ biz: null })
    expect(LEAD_FIELDS.map(f => f.key)).toEqual(['fname', 'lname', 'email', 'phone', 'biz', 'model', 'budget', 'timeline', 'need'])
  })

  it('the Leads page is the inbox: a row opens the page, no drawer, no stages of its own', () => {
    const page = readFileSync('app/dashboard/leads/page.tsx', 'utf8')
    expect(page).toContain("const open = (l: Lead) => router.push(leadPath(l.id))")
    expect(page).not.toContain('<Sheet')
    expect(page).not.toContain("from './Pipeline'")
    expect(page).toContain('Bring into acquisition')
    expect(page).toContain("<Chip tone=\"green\">{`In acquisition · ${acqStageByKey(p.stage).label}`}</Chip>")
    const lead = readFileSync('app/dashboard/leads/[id]/LeadPage.tsx', 'utf8')
    expect(lead).toContain("useRow<LeadLike & { id: string }>('leads', id)")
    expect(lead).toContain("call('Bring in', '/api/leads/acquisition/from-lead', { method: 'POST', body: JSON.stringify({ lead_id: id }) }")
    expect(lead).toContain("if (p?.id) router.push(prospectPagePath(p.id))")
    expect(readFileSync('app/dashboard/leads/[id]/page.tsx', 'utf8')).toContain('<LeadPage id={id} />')
  })
})
