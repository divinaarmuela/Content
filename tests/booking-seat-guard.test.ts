import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'
import { encodeKey, withRequestCache } from '@/lib/db'

/**
 * The guarantees Postgres used to enforce and that now live in code, tested
 * against the real `@/lib/db` over an in-memory Realtime Database.
 *
 * The point of every case here is the REQUEST CACHE. lib/db.ts serves a
 * repeated read of one table from one network call, which is what makes a
 * route cheap — and what would quietly turn every "check immediately before
 * the write" guard into a check against the state several round-trips ago.
 * `fresh: true` is the opt-out, and these tests are what prove it is actually
 * in the code paths that need it.
 */

const BOOKINGS_HREF = `admin-1__${encodeKey('/dashboard/bookings')}`

function baseRows() {
  return {
    team_users: [{
      id: 'admin-1', email: 'admin@x.invalid', name: 'Admin',
      role: 'super_admin', active_status: true,
    }] as unknown as Row[],
    user_page_access: [{ id: BOOKINGS_HREF, team_user_id: 'admin-1', href: '/dashboard/bookings' }] as unknown as Row[],
    booking_resources: [{
      id: 'res-1', label: 'Studio', timezone: 'Australia/Melbourne', active: true, space_id: null,
    }] as unknown as Row[],
    booking_services: [{
      id: 'svc-1', name: 'Shoot', slug: 'shoot', duration_min: 60, price_cents: 0,
      currency: 'AUD', active: true, sort_order: 1, capacity: 1,
    }] as unknown as Row[],
    bookings: [{
      id: 'bk-1', service_id: 'svc-1', resource_id: 'res-1', space_id: 'res-1', seat_no: 1,
      start_at: '2026-09-10T00:00:00.000Z', end_at: '2026-09-10T01:00:00.000Z',
      customer_name: 'Ada', customer_email: 'ada@x.invalid', customer_phone: '0400000000',
      status: 'confirmed', payment_status: 'unpaid', amount_cents: 0, public_ref: 'a'.repeat(18),
    }] as unknown as Row[],
  }
}

vi.mock('../app/lib/authz', () => ({
  requireRole: async () => ({
    id: 'admin-1', email: 'admin@x.invalid', name: 'Admin', role: 'super_admin',
  }),
  AuthzError: class AuthzError extends Error {
    status: number
    constructor(message: string, status: number) { super(message); this.status = status }
  },
  authzErrorResponse: (e: unknown) => ({
    error: e instanceof Error ? e.message : 'error',
    status: (e as { status?: number })?.status ?? 500,
  }),
}))
// both return promises in the real module; notifyStaffChange attaches a
// .catch to whatever comes back
vi.mock('../app/lib/booking-notify', () => ({
  notifyBookingChanged: vi.fn(async () => {}),
  notifyNewBooking: vi.fn(async () => {}),
}))

let fake: ReturnType<typeof seedDb> | null = null
afterEach(() => { fake?.restore(); fake = null; vi.restoreAllMocks() })

describe('seatIsFree reads past the request cache', () => {
  it('sees a booking written after the table was already read in this request', async () => {
    fake = seedDb(baseRows())
    const { seatIsFree } = await import('../app/lib/booking')
    const { table } = await import('@/lib/db')

    const answer = await withRequestCache(async () => {
      // the shape of a real route: something reads the whole table first (the
      // public book route counts this customer's recent bookings), which
      // populates the request cache with a copy that has no clash in it
      const before = await table('bookings').list()
      expect(before).toHaveLength(1)

      // …and meanwhile somebody else takes the seat
      fake!.tree().mdm.tables.bookings['bk-2'] = {
        id: 'bk-2', service_id: 'svc-1', resource_id: 'res-1', space_id: 'res-1', seat_no: 1,
        start_at: '2026-09-11T00:00:00.000Z', end_at: '2026-09-11T01:00:00.000Z',
        customer_name: 'Grace', customer_email: 'grace@x.invalid',
        status: 'confirmed', payment_status: 'unpaid', amount_cents: 0,
      }

      return seatIsFree({
        spaceId: 'res-1', seatNo: 1,
        startAt: '2026-09-11T00:30:00.000Z', endAt: '2026-09-11T01:30:00.000Z',
      })
    })

    expect(answer).toBe(false)
  })

  it('still answers true for a seat nobody holds', async () => {
    fake = seedDb(baseRows())
    const { seatIsFree } = await import('../app/lib/booking')
    const free = await withRequestCache(() => seatIsFree({
      spaceId: 'res-1', seatNo: 2,
      startAt: '2026-09-10T00:00:00.000Z', endAt: '2026-09-10T01:00:00.000Z',
    }))
    expect(free).toBe(true)
  })

  it('drops the stale whole-table entry, so a later list sees the new row too', async () => {
    fake = seedDb(baseRows())
    const { seatIsFree } = await import('../app/lib/booking')
    const { table } = await import('@/lib/db')

    const seen = await withRequestCache(async () => {
      await table('bookings').list()
      fake!.tree().mdm.tables.bookings['bk-3'] = {
        id: 'bk-3', resource_id: 'res-1', space_id: 'res-1', seat_no: 9,
        start_at: '2026-10-01T00:00:00.000Z', end_at: '2026-10-01T01:00:00.000Z',
        status: 'confirmed',
      }
      await seatIsFree({
        spaceId: 'res-1', seatNo: 9,
        startAt: '2026-10-01T00:00:00.000Z', endAt: '2026-10-01T01:00:00.000Z',
      })
      return (await table('bookings').list()).map(r => r.id)
    })

    expect(seen).toContain('bk-3')
  })
})

describe('booking admin — a write to a row that is gone', () => {
  it('update_service answers 500 rather than { service: null }', async () => {
    fake = seedDb(baseRows())
    const { POST } = await import('../app/api/booking/admin/route')
    const res = await POST(new Request('http://x/api/booking/admin', {
      method: 'POST',
      body: JSON.stringify({ action: 'update_service', id: 'svc-gone', name: 'Nope' }),
    }))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Service not found' })
  })

  it('update_resource answers 500 rather than { resource: null }', async () => {
    fake = seedDb(baseRows())
    const { POST } = await import('../app/api/booking/admin/route')
    const res = await POST(new Request('http://x/api/booking/admin', {
      method: 'POST',
      body: JSON.stringify({ action: 'update_resource', id: 'res-gone', label: 'Nope' }),
    }))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Resource not found' })
  })

  it('a service that is really there still updates', async () => {
    fake = seedDb(baseRows())
    const { POST } = await import('../app/api/booking/admin/route')
    const res = await POST(new Request('http://x/api/booking/admin', {
      method: 'POST',
      body: JSON.stringify({ action: 'update_service', id: 'svc-1', name: 'Renamed' }),
    }))
    expect(res.status).toBe(200)
    expect((await res.json()).service.name).toBe('Renamed')
  })

  it('cancel_booking cancels once and then refuses', async () => {
    fake = seedDb(baseRows())
    const { POST } = await import('../app/api/booking/admin/route')
    const call = () => POST(new Request('http://x/api/booking/admin', {
      method: 'POST',
      body: JSON.stringify({ action: 'cancel_booking', id: 'bk-1' }),
    }))
    expect((await call()).status).toBe(200)
    const second = await call()
    expect(second.status).toBe(409)
    expect(await second.json()).toEqual({ error: 'That booking is already cancelled' })
  })
})
