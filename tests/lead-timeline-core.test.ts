import { describe, it, expect } from 'vitest'
import { buildTimeline, firstTouch, adLines } from '@/app/lib/lead-timeline-core'

describe('lead timeline', () => {
  it('merges logged events and emails, newest first, first touch last', () => {
    const t = buildTimeline(
      { id: 'L', created_at: '2026-11-02T00:00:00Z', source: 'web_form' },
      [
        { id: 'a', at: '2026-11-01T00:00:00Z', kind: 'first_visit', title: 'First visit', meta: { utm_source: 'fb', utm_campaign: 'Nov', landing: '/' } },
        { id: 'b', at: '2026-11-02T00:00:00Z', kind: 'form', title: 'Filled in the website form' },
        { id: 'c', at: '2026-11-03T00:00:00Z', kind: 'booked', title: 'Booked Inquiry call' },
      ],
      [{ id: 'm', received_at: '2026-11-04T00:00:00Z', subject: 'Following up' }],
    )
    expect(t.map(i => i.kind)).toEqual(['email', 'booked', 'form', 'first_visit'])
    expect(firstTouch(t)!.lines).toEqual(['Source: Facebook', 'Campaign: Nov', 'Landed on: Home'])
  })
  it('an older lead with nothing logged still shows when it came in and its booking', () => {
    const t = buildTimeline({ id: 'L', created_at: '2026-11-09T00:00:00Z', source: 'fb', booking_status: 'booked', booking_event: 'Inquiry call', call_at: '2026-11-11T22:00:00Z', ad_campaign: 'Test' }, [], [])
    expect(t.map(i => i.kind).sort()).toEqual(['booked', 'came_in'])
    expect(t.find(i => i.kind === 'booked')!.detail).toContain('12 Nov')
  })
  it('a scanner lead does not show a guessed "came in" when its emails are there', () => {
    const t = buildTimeline({ id: 'L', created_at: '2026-09-01T00:00:00Z', source: 'email_ingest' }, [], [{ id: 'm', received_at: '2026-09-01T00:00:00Z', subject: 'Quote' }])
    expect(t).toHaveLength(1); expect(t[0].kind).toBe('email')
  })
  it('logged booking replaces the guessed one', () => {
    const t = buildTimeline({ id: 'L', created_at: 'x', booking_status: 'booked' }, [{ id: 'b', at: 'y', kind: 'booked', title: 'Booked' }], [])
    expect(t.filter(i => i.kind === 'booked')).toHaveLength(1)
  })
  it('ad lines skip empties', () => { expect(adLines({ utm_source: '', ad_set: 'S' })).toEqual(['Ad set: S']) })
})
