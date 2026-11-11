import { describe, expect, it } from 'vitest'
import { melbourneMonth, monthWords, summariseBookings, type CalEvent } from '../app/lib/bookings-core'

const ev = (created_at: string, status: CalEvent['status'] = 'active', start_time = created_at, name = 'Inquiry call - MD Media'): CalEvent =>
  ({ name, status, created_at, start_time })

describe('bookings report', () => {
  it('counts by the month the call was booked, in Melbourne time', () => {
    // 31 Oct 14:00 UTC is 1 Nov 01:00 in Melbourne
    expect(melbourneMonth('2026-10-31T14:00:00Z')).toBe('2026-11')
    expect(melbourneMonth('2026-10-31T12:00:00Z')).toBe('2026-10')
  })

  it('totals, cancellations, upcoming calls, newest month first', () => {
    const now = new Date('2026-11-11T00:00:00Z')
    const r = summariseBookings([
      ev('2026-10-02T00:00:00Z'),
      ev('2026-10-05T00:00:00Z', 'canceled'),
      ev('2026-11-10T00:00:00Z', 'active', '2026-11-20T00:00:00Z'),
      ev('2026-11-09T00:00:00Z', 'active', '2026-11-10T00:00:00Z', 'Other call'),
    ], now)
    expect(r).toMatchObject({ total: 4, kept: 3, cancelled: 1, upcoming: 1, oldest: '2026-10-02T00:00:00Z' })
    expect(r.months).toEqual([
      { month: '2026-11', booked: 2, cancelled: 0 },
      { month: '2026-10', booked: 2, cancelled: 1 },
    ])
    expect(r.types).toEqual([{ name: 'Inquiry call - MD Media', count: 3 }, { name: 'Other call', count: 1 }])
  })

  it('an empty account is all zeros, not a crash', () => {
    expect(summariseBookings([])).toMatchObject({ total: 0, kept: 0, cancelled: 0, upcoming: 0, months: [], oldest: null })
  })

  it('month words', () => {
    expect(monthWords('2026-11')).toBe('November 2026')
  })
})
