/**
 * Pure shoot-proposal core — no imports, no I/O, fully unit-testable.
 * Owns the status machine and the .ics the accepted shoot is delivered as.
 */

export type ShootStatus = 'pending' | 'accepted' | 'declined' | 'cancelled'

/** A client may change their answer while plans are still changeable — a
 *  declined shoot can become accepted and vice versa. A cancelled proposal is
 *  the team's deliberate act and the token stops working. */
export function canRespond(status: ShootStatus): boolean {
  return status !== 'cancelled'
}

export function nextStatus(current: ShootStatus, answer: 'yes' | 'no'): ShootStatus {
  if (!canRespond(current)) return current
  return answer === 'yes' ? 'accepted' : 'declined'
}

/** RFC 5545 instant: 20260821T090000Z */
function icsInstant(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

/**
 * The accepted shoot as an .ics attachment, so both sides add it to their
 * calendar with one click — no calendar write scope needed anywhere.
 * METHOD:REQUEST with both parties as attendees is what makes mail clients
 * offer "Add to calendar" instead of showing an opaque attachment.
 */
export function shootIcs(p: {
  uid: string
  title: string
  startsAt: string
  endsAt: string
  location?: string | null
  note?: string | null
  organizerEmail: string
  attendeeEmail: string
}): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MD Media//Shoot Proposals//EN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${p.uid}@mdmmarketing.com.au`,
    `DTSTAMP:${icsInstant(new Date().toISOString())}`,
    `DTSTART:${icsInstant(p.startsAt)}`,
    `DTEND:${icsInstant(p.endsAt)}`,
    `SUMMARY:${icsEscape(p.title)}`,
    ...(p.location ? [`LOCATION:${icsEscape(p.location)}`] : []),
    ...(p.note ? [`DESCRIPTION:${icsEscape(p.note)}`] : []),
    `ORGANIZER;CN=MD Media:mailto:${p.organizerEmail}`,
    `ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED:mailto:${p.attendeeEmail}`,
    `ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED:mailto:${p.organizerEmail}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  // RFC 5545 wants CRLF line endings
  return lines.join('\r\n') + '\r\n'
}
