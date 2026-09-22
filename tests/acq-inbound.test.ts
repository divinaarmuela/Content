import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { ALREADY_A_PROSPECT, inboundBusinessName, inboundCandidates, inboundFromWords, prospectFromLead } from '../app/lib/acq-inbound-core'

/** AN INBOUND LEAD BECOMES A PROSPECT (the acquisition blueprint; built 22 Sep 2026). */
const form = { id: 'l1', created_at: '2026-09-22T00:10:00.000Z', source: 'web_form', fname: 'Sam', lname: 'Lee', email: 'sam@ausvenueco.com.au', phone: '0400 000 000', biz: 'Australian Venue Co', need: 'Reels for three venues', model: 'Retainer' }
const mail = { id: 'l2', created_at: '2026-09-21T23:50:00.000Z', source: 'email_ingest', fname: null, lname: null, email: 'hello@gmail.com', biz: null, need: null }

describe('what a lead becomes', () => {
  it('a lead already, at New lead / Engaged, dated from when they wrote, owned by whoever brought it in', () => {
    const p = prospectFromLead(form, '2026-09-22T08:00:00.000Z', 'joy')
    expect(p).toMatchObject({
      business: 'Australian Venue Co', contact_name: 'Sam Lee', email: 'sam@ausvenueco.com.au', phone: '0400 000 000',
      website: 'https://ausvenueco.com.au', source: 'direct', source_detail: 'Wrote in through the website form',
      audit_angle: 'Reels for three venues · Retainer', stage: 'engaged', stage_entered_at: '2026-09-22T08:00:00.000Z',
      replied_at: '2026-09-22T00:10:00.000Z', owner_id: 'joy', added_by: 'joy', lead_id: 'l1',
    })
  })
  it('a name from the business, else the person, else the company’s domain — never a free-mail address as a website', () => {
    expect(inboundBusinessName(form)).toBe('Australian Venue Co')
    expect(inboundBusinessName({ ...form, biz: '' })).toBe('Sam Lee')
    expect(inboundBusinessName({ biz: 'outlook.com.au', fname: 'Violetta', lname: null, email: 'v@outlook.com.au' })).toBe('Violetta')
    expect(inboundBusinessName({ biz: null, fname: null, lname: null, email: 'x@crestline.com.au' })).toBe('crestline.com.au')
    expect(prospectFromLead(mail, '2026-09-22T08:00:00.000Z', 'joy')).toMatchObject({ website: null, business: 'hello@gmail.com', source_detail: 'Emailed the agency' })
    expect(inboundFromWords('other')).toBe('Came in as a lead')
  })
})

describe('which leads are offered', () => {
  it('the ones not in the system — by the lead they came from or the same address — newest first', () => {
    const none = inboundCandidates([form, mail], [])
    expect(none.map(c => c.lead_id)).toEqual(['l1', 'l2'])
    expect(none[0]).toMatchObject({ business: 'Australian Venue Co', who: 'Sam Lee', from: 'Wrote in through the website form', need: 'Reels for three venues' })
    expect(inboundCandidates([form, mail], [{ lead_id: 'l1' }]).map(c => c.lead_id)).toEqual(['l2'])
    expect(inboundCandidates([form, mail], [{ lead_id: null, email: 'SAM@ausvenueco.com.au' }]).map(c => c.lead_id)).toEqual(['l2'])
  })
  it('the route offers them, brings one in once, and puts the enquiry on the timeline as the reply it is', () => {
    const r = readFileSync('app/api/leads/acquisition/from-lead/route.ts', 'utf8')
    expect(r).toContain("await requireRole('scheduler')")
    expect(r).toContain('return NextResponse.json({ error: ALREADY_A_PROSPECT }, { status: 409 })')
    expect(r).toContain("kind: 'reply', by: user.id, source: 'system', at: lead.created_at")
    expect(ALREADY_A_PROSPECT).toBe('That lead is already in the acquisition system.')
    const acq = readFileSync('app/dashboard/leads/acquisition/Acquisition.tsx', 'utf8')
    expect(acq).toContain('From an inbound lead</Button>')
    expect(acq).toContain("onBring={leadId => call('/api/leads/acquisition/from-lead', 'POST', { lead_id: leadId }, 'Brought in — it is a lead now, in New lead / Engaged')}")
    expect(readFileSync('scripts/gen-db-types.mjs', 'utf8')).toContain("['lead_id', col('string', true)],")
    // the live Leads page stays as it was (the owner, 21 Sep 2026)
    expect(readFileSync('app/dashboard/leads/Pipeline.tsx', 'utf8')).not.toContain('from-lead')
  })
})
