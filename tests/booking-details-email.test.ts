import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { BOOKING_BLOCK_TO, BOOKING_DETAILS_TO, bookingDetails, bookingIcs, bookingSlot, bookingUids, inviteeId, parseBooking } from '../app/lib/calendly-core'

/**
 * A BOOKING'S DETAILS BY EMAIL (the owner, 12 Nov 2026): hello@ and contact@ get the questions and answers; info@
 * never does, by email or through a calendar entry it can open.
 */
const body = {
  event: 'invitee.created',
  payload: {
    uri: 'https://api.calendly.com/scheduled_events/EV1/invitees/INV-123', email: 'Sam@Example.com', name: 'Sam Lee',
    scheduled_event: { name: 'Inquiry call - MD Media', start_time: '2026-12-25T03:00:00.000000Z', end_time: '2026-12-25T03:10:00.000000Z', location: { type: 'outbound_call', location: '+61 400 000 000' } },
    questions_and_answers: [
      { question: 'Which service are you after?', answer: 'Podcast Studio' },
      { question: 'What is your current monthly marketing budget?', answer: '$2,000 – $3,500/month' },
      { question: "What's your #1 goal in the next 90 days?", answer: 'More leads' },
      { question: 'How did you find MD Marketing?', answer: 'Instagram' },
    ],
  },
}

describe('Calendly booking: the details email', () => {
  const b = parseBooking(body)!
  const d = bookingDetails(b, 'Fri, 25 Dec, 2:00 pm')!

  it('the app emails the details to nobody now, Calendly sends its own (13 Nov 2026), and never to info@', () => {
    expect([...BOOKING_DETAILS_TO]).toEqual([])
    expect(BOOKING_DETAILS_TO.some(a => a.startsWith('info@'))).toBe(false)
  })
  it('says who, what call, when, how to reach them, and every answer', () => {
    expect(d.subject).toBe('New call booked: Sam Lee (Inquiry call - MD Media)')
    expect(d.rows).toEqual([
      ['Call', 'Inquiry call - MD Media'], ['When', 'Fri, 25 Dec, 2:00 pm'], ['Name', 'Sam Lee'], ['Email', 'sam@example.com'],
      ['Phone', '+61 400 000 000'], ['Service', 'Podcast Studio'], ['Budget', '$2,000 – $3,500/month'],
    ])
    expect(d.answers).toContain('More leads')
    expect(d.answers).toContain('How did you find MD Marketing?\nInstagram')
  })
  it('the calendar entry has the exact time and who to ring, and none of the answers', () => {
    expect(d.calendar).toMatchObject({ uid: 'call-INV-123', title: 'Inquiry call - MD Media: Sam Lee', startsAt: '2026-12-25T03:00:00.000Z', endsAt: '2026-12-25T03:10:00.000Z' })
    const note = d.calendar!.note
    expect(note).toContain('Phone: +61 400 000 000')
    for (const secret of ['Podcast Studio', '$2,000', 'More leads', 'Instagram']) expect(note).not.toContain(secret)
  })
  it('ten minutes when Calendly gives no end time; no entry at all without a start', () => {
    expect(bookingDetails({ ...b, endsAt: null }, null)!.calendar!.endsAt).toBe('2026-12-25T03:10:00.000Z')
    expect(bookingDetails({ ...b, startsAt: null }, null)!.calendar).toBeNull()
  })
  it('only a new booking sends it; one id per booking', () => {
    expect(bookingDetails({ ...b, kind: 'cancelled' }, null)).toBeNull()
    expect(inviteeId(b.inviteeUri)).toBe('INV-123')
  })
  it('info@ gets only the time block: the call and its time, under its own calendar id', () => {
    expect([...BOOKING_BLOCK_TO]).toEqual(['info@mdmmarketing.com.au'])
    expect(bookingSlot(b)).toEqual({ title: 'Inquiry call - MD Media', startsAt: '2026-12-25T03:00:00.000Z', endsAt: '2026-12-25T03:10:00.000Z' })
    expect(bookingUids(b)).toEqual({ details: 'call-INV-123', block: 'call-INV-123-block' })
    const src = readFileSync('app/lib/calendly.ts', 'utf8')
    const block = src.slice(src.indexOf('for (const to of BOOKING_BLOCK_TO)'))
    expect(block).toContain('invite(to, uids.block, call, null)') // no name in the title, no note
    expect(block).not.toContain('bookingDetailsHtml')
  })
  it('an invitation blocks the time; the same id cancelled takes it off again', () => {
    const base = { uid: 'call-INV-123', title: 'Inquiry call - MD Media', startsAt: '2026-12-25T03:00:00.000Z', endsAt: '2026-12-25T03:10:00.000Z', organizerEmail: 'no-reply@mdmmarketing.com.au', attendeeEmail: 'info@mdmmarketing.com.au', stamp: '2026-11-12T10:00:00.000Z' }
    const ask = bookingIcs({ ...base, method: 'REQUEST', note: 'Name: Sam; Lee' })
    expect(ask).toContain('METHOD:REQUEST\r\n')
    expect(ask).toContain('UID:call-INV-123@mdmmarketing.com.au')
    expect(ask).toContain('DTSTART:20261225T030000Z')
    expect(ask).toContain('DTEND:20261225T031000Z')
    expect(ask).toContain('DESCRIPTION:Name: Sam\\; Lee')
    expect(ask).toContain('STATUS:CONFIRMED')
    expect(ask).toContain('SEQUENCE:0')
    const gone = bookingIcs({ ...base, method: 'CANCEL' })
    expect(gone).toContain('METHOD:CANCEL')
    expect(gone).toContain('UID:call-INV-123@mdmmarketing.com.au')
    expect(gone).toContain('STATUS:CANCELLED')
    expect(gone).toContain('SEQUENCE:1')
    expect(gone).not.toContain('DESCRIPTION')
  })
  it('the webhook tells the inboxes about a booking and about its cancellation', () => {
    const hook = readFileSync('app/api/calendly/webhook/route.ts', 'utf8')
    expect(hook).toContain("if (booking.kind === 'booked' || booking.kind === 'cancelled') await sendBookingDetails(")
  })
})
