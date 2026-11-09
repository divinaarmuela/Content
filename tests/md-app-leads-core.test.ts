import { describe, expect, it } from 'vitest'
import { fieldLabel, parseLeadForms, parseLeads } from '../app/lib/md-app-leads-core'

describe('MD App Leads — reading Meta (9 Nov 2026)', () => {
  it('forms with their lead counts', () => {
    expect(parseLeadForms({ data: [{ id: '11', name: 'Bookings', status: 'ACTIVE', leads_count: 3 }, { id: '12' }] })).toEqual([
      { id: '11', name: 'Bookings', status: 'ACTIVE', leads: 3, created: null },
      { id: '12', name: 'Untitled form', status: 'UNKNOWN', leads: null, created: null },
    ])
  })

  it('a lead: name, email and phone lifted out, other answers labelled, newest first', () => {
    const out = parseLeads({ data: [
      { id: 'a', created_time: '2026-11-08T01:00:00+0000', is_organic: true,
        field_data: [{ name: 'full_name', values: ['Ana Lee'] }, { name: 'email', values: ['ana@example.invalid'] }] },
      { id: 'b', created_time: '2026-11-09T01:00:00+0000', campaign_name: 'Spring',
        field_data: [
          { name: 'first_name', values: ['Bo'] }, { name: 'last_name', values: ['Tan'] },
          { name: 'phone_number', values: ['+61400000000'] }, { name: 'what_time_suits_you?', values: ['Mornings'] },
        ] },
    ] })
    expect(out.map(l => l.id)).toEqual(['b', 'a'])
    expect(out[0]).toMatchObject({ name: 'Bo Tan', phone: '+61400000000', email: null, source: 'Spring' })
    expect(out[0].other).toEqual([{ label: 'What time suits you?', value: 'Mornings' }])
    expect(out[1]).toMatchObject({ name: 'Ana Lee', email: 'ana@example.invalid', source: 'Organic' })
  })

  it('labels', () => {
    expect(fieldLabel('preferred_contact_method')).toBe('Preferred contact method')
  })
})

describe('archived forms are left out (9 Nov 2026)', () => {
  it('keeps active forms only', async () => {
    const { parseLeadForms } = await import('../app/lib/md-app-leads-core')
    expect(parseLeadForms({ data: [{ id: '1', name: 'Table booking', status: 'ACTIVE' }, { id: '2', name: 'Book a table', status: 'ARCHIVED' }] }).map(f => f.id)).toEqual(['1'])
  })
})
