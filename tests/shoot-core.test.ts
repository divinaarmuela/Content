import { describe, it, expect } from 'vitest'
import { canRespond, nextStatus, shootIcs, splitRecipients } from '../app/lib/shoot-core'

describe('shoot status machine', () => {
  it('pending answers land on accepted or declined', () => {
    expect(nextStatus('pending', 'yes')).toBe('accepted')
    expect(nextStatus('pending', 'no')).toBe('declined')
  })

  it('the FIRST answer is final — a second click cannot reverse it', () => {
    expect(canRespond('accepted')).toBe(false)
    expect(canRespond('declined')).toBe(false)
    expect(nextStatus('accepted', 'no')).toBe('accepted')
    expect(nextStatus('declined', 'yes')).toBe('declined')
  })

  it('a cancelled proposal stops accepting answers', () => {
    expect(canRespond('cancelled')).toBe(false)
    expect(nextStatus('cancelled', 'yes')).toBe('cancelled')
    expect(nextStatus('cancelled', 'no')).toBe('cancelled')
  })

  it('only pending can be answered', () => {
    expect(canRespond('pending')).toBe(true)
  })
})

describe('splitRecipients', () => {
  it('splits, trims, lowercases and drops blanks', () => {
    expect(splitRecipients('A@x.com,  b@y.com , ,c@z.com'))
      .toEqual(['a@x.com', 'b@y.com', 'c@z.com'])
  })

  it('a single address round-trips', () => {
    expect(splitRecipients('justin@tkbg.com.au')).toEqual(['justin@tkbg.com.au'])
  })

  it('an empty list stays empty', () => {
    expect(splitRecipients('')).toEqual([])
  })
})

describe('shootIcs', () => {
  const ics = shootIcs({
    uid: 'abc-123',
    title: 'Content shoot — Turnkey',
    startsAt: '2026-08-21T09:00:00+10:00',
    endsAt: '2026-08-21T12:00:00+10:00',
    location: 'Their venue, Melbourne',
    note: 'Bring the drone;\nand the gimbal',
    organizerEmail: 'hello@mdmmarketing.com.au',
    attendeeEmail: 'justin@tkbg.com.au',
  })

  it('is a METHOD:REQUEST calendar with CRLF endings', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(ics).toContain('METHOD:REQUEST')
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    // no bare LFs — RFC 5545 wants CRLF
    expect(ics.replace(/\r\n/g, '').includes('\n')).toBe(false)
  })

  it('converts Melbourne times to UTC instants', () => {
    expect(ics).toContain('DTSTART:20260820T230000Z') // 9am AEST = 23:00 UTC previous day
    expect(ics).toContain('DTEND:20260821T020000Z')
  })

  it('escapes RFC 5545 special characters in text fields', () => {
    expect(ics).toContain('LOCATION:Their venue\\, Melbourne')
    expect(ics).toContain('DESCRIPTION:Bring the drone\\;\\nand the gimbal')
  })

  it('carries both parties and the uid', () => {
    expect(ics).toContain('UID:abc-123@mdmmarketing.com.au')
    expect(ics).toContain('mailto:justin@tkbg.com.au')
    expect(ics).toContain('mailto:hello@mdmmarketing.com.au')
  })
})
