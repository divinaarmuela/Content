import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { table, encodeKey } from '../../lib/db'
import type { Booking, BookingResource, BookingService } from '../../lib/db-types'
import { insertBooking, moveBooking, spaceForResource } from '../../app/lib/booking'

/**
 * The no-overlap guarantee, played live against the real database.
 *
 * Postgres enforced "no two live bookings for the same seat in the same room
 * may overlap in time" with a GiST exclusion constraint evaluated INSIDE the
 * insert. The Realtime Database has no such thing, so app/lib/booking.ts ports
 * it to a single compare-and-set on a `booking_seats` row. A port of a
 * constraint is only worth what it survives under real concurrency — so this
 * file fires the racing writes at the real database, at the same instant, and
 * insists that exactly one of them lands.
 *
 * Safety, the same discipline as its siblings in this folder:
 *  - it creates its OWN resource and service, labelled `ZZ TEST RACE …`, and
 *    never touches an existing one;
 *  - the only email it writes is `@mdmedia-test.invalid`;
 *  - EMAIL_TEST_ONLY=1 comes from tests/e2e/load-env.ts;
 *  - everything it created is deleted in afterAll and the tables are read back
 *    to prove it.
 */

const STAMP = Date.now()
const LABEL = `ZZ TEST RACE room ${STAMP}`
const SVC_NAME = `ZZ TEST RACE service ${STAMP}`
const TZ = 'Australia/Melbourne'
const EMAIL = 'race@mdmedia-test.invalid'

let resourceId = ''
let spaceId = ''
let service60 = ''
let service120 = ''

/** every bookings id this file created — the teardown list */
const created = new Set<string>()

/** the booking_seats row id app/lib/booking.ts claims for (space, seat) */
const seatKey = (space: string, seat: number | null) => `${encodeKey(space)}__${seat ?? 'x'}`

/** a plain YYYY-MM-DD n days from today, no timezone arithmetic */
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)
/** an instant at a whole/half hour on that day, in UTC — the layer under test
 *  compares ISO strings, so the wall clock it belongs to does not matter */
const at = (d: string, hour: number, min = 0) =>
  `${d}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00.000Z`

async function book(startAt: string, endAt: string, serviceId: string): Promise<Booking> {
  const b = await insertBooking({
    resource_id: resourceId,
    service_id: serviceId,
    start_at: startAt,
    end_at: endAt,
    customer_name: 'ZZ TEST RACE customer',
    customer_email: EMAIL,
    customer_phone: null,
    notes: 'ZZ TEST RACE — automated no-overlap proof',
    status: 'confirmed',
    payment_status: 'unpaid',
    amount_cents: 0,
    seat_no: 1,
  })
  created.add(b.id)
  return b
}

/** insertBooking rejects with the constraint's own name; this is that check */
const isOverlapRefusal = (e: unknown) =>
  e instanceof Error && /bookings_no_overlap/.test(e.message)

/** allSettled, but remembering the ids of whatever actually landed */
async function race(...calls: Promise<Booking>[]) {
  const settled = await Promise.allSettled(calls)
  for (const r of settled) if (r.status === 'fulfilled') created.add(r.value.id)
  return settled
}

beforeAll(async () => {
  // shape mirrored from a live booking_resources row (MD House Podcast Studio)
  const resource = await table<BookingResource>('booking_resources').insert({
    created_at: new Date().toISOString(),
    label: LABEL,
    email: EMAIL,
    timezone: TZ,
    active: true,
    space_id: null,          // a resource with no space of its own IS its own space
  })
  resourceId = resource.id
  spaceId = await spaceForResource(resourceId)
  expect(spaceId).toBe(resourceId)

  const svc = (name: string, slug: string, duration: number) =>
    table<BookingService>('booking_services').insert({
      created_at: new Date().toISOString(),
      name,
      slug,
      description: null,
      duration_min: duration,
      price_cents: 0,
      currency: 'AUD',
      active: false,          // never offered on the public page
      sort_order: 9999,
      policy_text: null,
      resource_id: resourceId,
      lead_time_min: 0,
      horizon_days: 365,
      requires_payment: false,
      image_url: null,
      location: null,
      category: 'ZZ TEST RACE',
      capacity: 1,
    })

  service60 = (await svc(`${SVC_NAME} 60`, `zz-test-race-60-${STAMP}`, 60)).id
  service120 = (await svc(`${SVC_NAME} 120`, `zz-test-race-120-${STAMP}`, 120)).id

  console.log(`[setup] resource=${resourceId} space=${spaceId} svc60=${service60} svc120=${service120}`)
})

describe('bookings_no_overlap, live and concurrent', () => {
  it('A: a 2-hour session at 10:00 and a 1-hour at 11:00 cannot both land', async () => {
    for (let rep = 0; rep < 5; rep++) {
      const d = day(1 + rep)   // fresh times every repetition
      const settled = await race(
        book(at(d, 10), at(d, 12), service120),
        book(at(d, 11), at(d, 12), service60),
      )
      const won = settled.filter(r => r.status === 'fulfilled')
      const lost = settled.filter(r => r.status === 'rejected') as PromiseRejectedResult[]
      expect(won.length, `rep ${rep} (${d}): winners`).toBe(1)
      expect(lost.length, `rep ${rep} (${d}): losers`).toBe(1)
      expect(isOverlapRefusal(lost[0].reason), `rep ${rep}: ${String(lost[0].reason)}`).toBe(true)
      console.log(`[A rep ${rep}] ${d}: 1 won, 1 refused — ${(lost[0].reason as Error).message}`)
    }
  })

  it('B: back-to-back 10:00–12:00 and 12:00–13:00 both land (half-open)', async () => {
    const d = day(7)
    const settled = await race(
      book(at(d, 10), at(d, 12), service120),
      book(at(d, 12), at(d, 13), service60),
    )
    const reasons = settled.filter(r => r.status === 'rejected')
      .map(r => String((r as PromiseRejectedResult).reason))
    expect(reasons, `${d}: adjacent bookings must not clash`).toEqual([])
    expect(settled.every(r => r.status === 'fulfilled')).toBe(true)
    console.log(`[B] ${d}: both 10–12 and 12–13 landed`)
  })

  it('C: six concurrent bookings over one shared hour — exactly one wins', async () => {
    const d = day(8)
    // every span covers 11:00–12:00, so no two of them may coexist
    const spans: [number, number][] = [[9, 12], [10, 12], [11, 12], [11, 13], [11, 14], [10, 13]]
    const settled = await race(
      ...spans.map(([s, e]) => book(at(d, s), at(d, e), service60)),
    )
    const won = settled.filter(r => r.status === 'fulfilled')
    const lost = settled.filter(r => r.status === 'rejected') as PromiseRejectedResult[]
    expect(won.length, `${d}: winners`).toBe(1)
    expect(lost.length).toBe(5)
    for (const l of lost) expect(isOverlapRefusal(l.reason), String(l.reason)).toBe(true)
    console.log(`[C] ${d}: 1 of 6 landed, 5 refused with bookings_no_overlap`)
  })

  it('D: moveBooking refuses a move onto a taken time and allows one past it', async () => {
    const d = day(9)
    const held = await book(at(d, 10), at(d, 11), service60)
    const mover = await book(at(d, 14), at(d, 15), service60)

    const clash = await moveBooking(mover.id, at(d, 10, 30), at(d, 11, 30))
    expect(clash.ok, 'move onto 10:30–11:30 must be refused').toBe(false)
    expect(clash.ok === false && clash.reason).toBe('clash')

    const ok = await moveBooking(mover.id, at(d, 11), at(d, 12))
    expect(ok.ok, 'move onto 11:00–12:00 must be allowed').toBe(true)
    if (ok.ok) {
      expect(ok.booking.start_at).toBe(at(d, 11))
      expect(ok.booking.end_at).toBe(at(d, 12))
    }
    // the held booking is untouched
    const still = await table<Booking>('bookings').get(held.id, { fresh: true })
    expect(still?.start_at).toBe(at(d, 10))
    console.log(`[D] ${d}: 10:30–11:30 refused (clash), 11:00–12:00 allowed`)
  })
})

afterAll(async () => {
  const bookings = table<Booking>('bookings')
  for (const id of created) await bookings.remove(id).catch(() => {})
  await table('booking_seats').remove(seatKey(spaceId, 1)).catch(() => {})
  if (service60) await table('booking_services').remove(service60).catch(() => {})
  if (service120) await table('booking_services').remove(service120).catch(() => {})
  if (resourceId) await table('booking_resources').remove(resourceId).catch(() => {})

  // read back — nothing this file made may survive
  const [leftBookings, leftSeats, leftSvc, leftRes] = await Promise.all([
    bookings.list({ fresh: true, where: b => b.resource_id === resourceId || b.space_id === spaceId }),
    table<{ id: string }>('booking_seats').list({ fresh: true, where: s => s.id.startsWith(encodeKey(spaceId)) }),
    table<BookingService>('booking_services').list({ fresh: true, where: s => s.name.startsWith('ZZ TEST RACE') || (s.category ?? '') === 'ZZ TEST RACE' }),
    table<BookingResource>('booking_resources').list({ fresh: true, where: r => r.label.startsWith('ZZ TEST RACE') }),
  ])
  console.log('[teardown] removed bookings:', [...created].join(', ') || '(none)')
  console.log('[teardown] read-back leftovers — bookings:', leftBookings.length,
    'seats:', leftSeats.length, 'services:', leftSvc.length, 'resources:', leftRes.length)
  expect(leftBookings.map(b => b.id)).toEqual([])
  expect(leftSeats.map(s => s.id)).toEqual([])
  expect(leftSvc.map(s => s.id)).toEqual([])
  expect(leftRes.map(r => r.id)).toEqual([])
})
