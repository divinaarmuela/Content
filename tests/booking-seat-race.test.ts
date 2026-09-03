import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'
import { withRequestCache } from '@/lib/db'

/**
 * Two customers, one seat, the same second.
 *
 * `bookings_no_overlap` was a GiST exclusion constraint: Postgres decided
 * inside the insert, so a second overlapping booking simply could not exist.
 * Asking "is the seat free?" and then writing is not that — both callers pass
 * the question. Here the seat is a row of its own and taking a range on it is
 * one conditional write, so one customer gets the studio and the other is
 * refused with the constraint's own name.
 */

vi.mock('../app/lib/booking-notify', () => ({
  notifyBookingChanged: vi.fn(async () => {}),
  notifyNewBooking: vi.fn(async () => {}),
}))

const { insertBooking, moveBooking } = await import('../app/lib/booking')

const rows = () => ({
  booking_resources: [{
    id: 'res-1', label: 'Studio', timezone: 'Australia/Melbourne', active: true, space_id: null,
  }] as unknown as Row[],
})

const at = (h: number) => `2026-09-10T0${h}:00:00.000Z`
const slot = (h: number) => ({
  resource_id: 'res-1', service_id: 'svc-1',
  start_at: at(h), end_at: at(h + 1),
  customer_name: 'Ada', customer_email: 'ada@x.invalid',
})

let fake: ReturnType<typeof seedDb> | null = null
afterEach(() => { fake?.restore(); fake = null })

describe('bookings_no_overlap under a race', () => {
  it('two bookings for the same seat and time leave exactly one', async () => {
    fake = seedDb(rows())
    const results = await Promise.allSettled([
      insertBooking(slot(1)),
      insertBooking(slot(1)),
    ])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    const refused = results.find(r => r.status === 'rejected') as PromiseRejectedResult
    expect(String(refused.reason.message)).toContain('bookings_no_overlap')
    expect(fake.rows('bookings')).toHaveLength(1)
  })

  it('a booking landing between this one\'s read and its write still wins the seat', async () => {
    fake = seedDb(rows())
    await insertBooking(slot(1))
    // …and a rival takes 01:30–02:30 in the gap before our own claim lands
    const off = fake.onBeforeWrite('/mdm/tables/booking_seats/res-1__1', async () => {
      off()
      fake!.tree().mdm.tables.booking_seats['res-1__1'].ranges.push({
        booking_id: 'rival', start: '2026-09-10T01:30:00.000Z', end: '2026-09-10T02:30:00.000Z',
        at: new Date().toISOString(),
      })
    })
    await expect(insertBooking(slot(2))).rejects.toMatchObject({ code: 'unique' })
    expect(fake.rows('bookings')).toHaveLength(1)
  })

  it('back-to-back sessions are not a clash — the range is half-open', async () => {
    fake = seedDb(rows())
    await insertBooking(slot(1))
    await insertBooking(slot(2))
    expect(fake.rows('bookings')).toHaveLength(2)
  })

  it('a different seat in the same room is untouched', async () => {
    fake = seedDb(rows())
    await insertBooking(slot(1))
    await insertBooking({ ...slot(1), seat_no: 2 })
    expect(fake.rows('bookings')).toHaveLength(2)
  })

  it('honours bookings that predate the seat row, seeding them on the first claim', async () => {
    fake = seedDb({
      ...rows(),
      bookings: [{
        id: 'bk-old', resource_id: 'res-1', space_id: 'res-1', seat_no: 1,
        start_at: at(1), end_at: at(2), status: 'confirmed',
        created_at: '2026-09-01T00:00:00.000Z',
      }] as unknown as Row[],
    })
    await expect(insertBooking(slot(1))).rejects.toMatchObject({ code: 'unique' })
  })

  it('a cancelled booking stops holding its seat', async () => {
    fake = seedDb({
      ...rows(),
      bookings: [{
        id: 'bk-old', resource_id: 'res-1', space_id: 'res-1', seat_no: 1,
        start_at: at(1), end_at: at(2), status: 'cancelled',
        created_at: '2026-09-01T00:00:00.000Z',
      }] as unknown as Row[],
    })
    const made = await insertBooking(slot(1))
    expect(made.id).toBeTruthy()
  })

  it('a request that already read the bookings table still sees a seat taken since', async () => {
    fake = seedDb(rows())
    await withRequestCache(async () => {
      const { table } = await import('@/lib/db')
      await table('bookings').list()                 // the request cache is now warm
      await insertBooking(slot(1))
      await expect(insertBooking(slot(1))).rejects.toMatchObject({ code: 'unique' })
    })
  })
})

describe('moveBooking', () => {
  it('moves a live booking and refuses a time somebody else holds', async () => {
    fake = seedDb(rows())
    const a = await insertBooking(slot(1))
    const b = await insertBooking(slot(3))

    const clash = await moveBooking(b.id, at(1), at(2))
    expect(clash).toEqual({ ok: false, reason: 'clash' })

    const moved = await moveBooking(b.id, at(5), at(6))
    expect(moved.ok).toBe(true)
    expect(fake.rows('bookings').find(r => r.id === b.id)).toMatchObject({ start_at: at(5) })
    // …and the slot it left is free again
    expect((await moveBooking(a.id, at(3), at(4))).ok).toBe(true)
  })

  it('refuses to move a booking cancelled between the read and the write', async () => {
    fake = seedDb(rows())
    const a = await insertBooking(slot(1))
    const off = fake.onBeforeWrite(`/mdm/tables/bookings/${a.id}`, () => {
      off()
      fake!.tree().mdm.tables.bookings[a.id].status = 'cancelled'
    })
    expect(await moveBooking(a.id, at(5), at(6))).toEqual({ ok: false, reason: 'not_live' })
    expect(fake.rows('bookings')[0]).toMatchObject({ start_at: at(1), status: 'cancelled' })
  })

  it('a cancelled booking cannot be moved at all', async () => {
    fake = seedDb({
      ...rows(),
      bookings: [{
        id: 'bk-x', resource_id: 'res-1', space_id: 'res-1', seat_no: 1,
        start_at: at(1), end_at: at(2), status: 'cancelled',
      }] as unknown as Row[],
    })
    expect(await moveBooking('bk-x', at(5), at(6))).toEqual({ ok: false, reason: 'not_live' })
  })
})
