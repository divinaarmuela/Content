import 'server-only'
import { DbError, encodeKey, table } from '@/lib/db'
import type {
  Booking, BookingAvailability, BookingBlackout, BookingResource, BookingService,
} from '@/lib/db-types'
import { openSlots, minToLabel, zonedToUtc, utcToZoned, weekdayOf } from './booking-core'

/**
 * The booking read layer: turns a resource's weekly opening hours into real,
 * bookable instants for the public page.
 *
 * Everything the public sees passes through here, so it is also the place
 * that decides what a stranger may learn: service name, duration, price and
 * free times — never a resource's email, never another customer's booking.
 */

export type PublicService = {
  id: string
  name: string
  slug: string
  description: string | null
  duration_min: number
  price_cents: number
  currency: string
  lead_time_min: number
  horizon_days: number
  requires_payment: boolean
  resource_id: string | null
  /** seats per slot: 1 = private hire, >1 = an event */
  capacity: number
  /** hero image + where it happens — a room sells better than a paragraph */
  image_url: string | null
  location: string | null
  /** which studio it belongs to, for grouping the public list */
  category: string | null
}

/**
 * A bookable resource, and the physical SPACE it occupies.
 *
 * "MD House Podcast Studio" and "MD House Creative Studio" are two names for
 * one room. Two names is useful — it says what kind of session it is — but
 * they cannot be booked at the same time, so they share a space. Availability
 * and the database constraint both key on the space, never on the name.
 *
 * A resource with no space of its own is its own space, so a genuinely
 * separate second room needs no special handling.
 */
export type PublicResource = { id: string; label: string; timezone: string; space_id: string }

/** Resources are grouped by the room they physically are, not what they're called. */
const spaceOf = (r: { id: string; space_id?: string | null }) => r.space_id ?? r.id

const toResource = (row: Record<string, unknown>): PublicResource => ({
  id: row.id as string,
  label: row.label as string,
  timezone: row.timezone as string,
  space_id: (row.space_id as string | null) ?? (row.id as string),
})

export type DaySlots = {
  day: string
  slots: { min: number; label: string; resource_id: string }[]
}

const DEFAULTS = { lead_time_min: 120, horizon_days: 60 }

/** Fill in anything a newer migration adds, so a half-migrated database
 *  still serves a working booking page instead of a 404. */
function withDefaults(row: Record<string, unknown>): PublicService {
  const r = row as Partial<PublicService> & Record<string, unknown>
  return {
    ...(row as PublicService),
    lead_time_min: typeof r.lead_time_min === 'number' ? r.lead_time_min : DEFAULTS.lead_time_min,
    horizon_days: typeof r.horizon_days === 'number' ? r.horizon_days : DEFAULTS.horizon_days,
    requires_payment: r.requires_payment === true,
    capacity: typeof r.capacity === 'number' && r.capacity > 0 ? r.capacity : 1,
    image_url: (r.image_url as string | null) ?? null,
    location: (r.location as string | null) ?? null,
    category: (r.category as string | null) ?? null,
    resource_id: (r.resource_id as string | null) ?? null,
  }
}

/** The service behind a public slug, plus the resources that can deliver it.
 *  Returns null for anything inactive or unknown — a stranger cannot tell a
 *  disabled service from a made-up one. */
export async function loadPublicService(
  slug: string,
): Promise<{ service: PublicService; resources: PublicResource[] } | null> {
  if (!/^[a-z0-9-]{1,60}$/.test(slug)) return null
  const svc = (await table<BookingService>('booking_services').list({
    by: { slug, active: true }, limit: 1,
  }))[0]
  if (!svc) return null

  const service = withDefaults(svc as unknown as Record<string, unknown>)

  const resources = await table<BookingResource>('booking_resources').list({
    by: { active: true },
    where: r => !service.resource_id || r.id === service.resource_id,
    orderBy: [['created_at', 'asc']],
  })
  if (resources.length === 0) return null
  return { service, resources: resources.map(r => toResource(r as unknown as Record<string, unknown>)) }
}

/**
 * Release slots held by a checkout nobody finished.
 *
 * An unpaid booking holds its slot so two people cannot pay for the same
 * time. Stripe expires an abandoned session and the webhook frees it — but
 * that is a promise from another system, and if it ever fails to arrive the
 * slot is held forever. This is the floor under that: any pending, unpaid
 * hold older than the checkout window is dead, whatever Stripe said.
 *
 * Idempotent and safe to run on every availability read.
 */
async function releaseStaleHolds(): Promise<void> {
  // Not a guess: the checkout session is created with a 31-minute life, so a
  // hold older than that CANNOT still be paid — the card form is already
  // dead. One extra minute covers clock skew between us and Stripe. Waiting
  // longer just keeps a bookable slot off the calendar while someone who
  // wants it is looking at it.
  const cutoff = new Date(Date.now() - 32 * 60_000).toISOString()
  try {
    const bookings = table<Booking>('bookings')
    const stale = await bookings.list({
      by: { status: 'pending' },
      where: r => r.payment_status === 'unpaid' && r.created_at < cutoff,
    })
    await Promise.all(stale.map(b => bookings.update(b.id, { status: 'cancelled' })))
  } catch (e) {
    console.error('stale hold sweep failed:', e)
  }
}

/** Add days to a plain YYYY-MM-DD without touching timezones. */
function addDays(dayISO: string, n: number): string {
  return new Date(Date.parse(`${dayISO}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
}

/**
 * Open slots per day, across every resource that can deliver the service.
 *
 * A slot is offered when at least one resource is free for it; the booking
 * call then claims a specific one. Days are the RESOURCE's local days, which
 * is why every comparison goes through the timezone helpers rather than the
 * server's own clock.
 */
export async function availabilityFor(
  service: PublicService,
  resources: PublicResource[],
  fromDay: string,
  days: number,
): Promise<DaySlots[]> {
  const span = Math.min(31, Math.max(1, Math.round(days)))
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDay)) return []
  // abandoned checkouts stop blocking before we decide what is free
  await releaseStaleHolds()
  const lastDay = addDays(fromDay, span - 1)
  const ids = resources.map(r => r.id)

  /**
   * Everything standing in the same ROOM, whatever it is called.
   *
   * Opening hours stay per-resource — they are not "when is the room open"
   * but "when do we offer THIS kind of session", so podcasts until 5 and
   * shoots until 9 is a legitimate setup.
   *
   * Occupancy and closures are the room's, though. A 2-hour Shoot & Go on
   * "Creative Studio" fills the space a podcast wants at 10:00, and a day
   * closed for a public holiday is closed no matter what the booking is
   * called. Both are gathered per SPACE.
   */
  const spaces = new Set(resources.map(spaceOf))
  const allRes = await table<BookingResource>('booking_resources').list({ by: { active: true } })
  const roommates = allRes
    .map(r => toResource(r as unknown as Record<string, unknown>))
    .filter(r => spaces.has(spaceOf(r)))
  // never narrower than the resources we were handed
  const occupancyIds = [...new Set([...ids, ...roommates.map(r => r.id)])]
  const spaceById = new Map(roommates.map(r => [r.id, spaceOf(r)]))
  // one timezone per space: it is one physical room, so it has one clock
  const tzBySpace = new Map(resources.map(r => [spaceOf(r), r.timezone]))

  // one read each — never per-day, never per-resource
  const fromEdge = `${addDays(fromDay, -1)}T00:00:00Z`
  const toEdge = `${addDays(lastDay, 2)}T00:00:00Z`
  const [hours, blackouts, taken] = await Promise.all([
    table<BookingAvailability>('booking_availability').list({
      where: h => ids.includes(h.resource_id),
    }),
    table<BookingBlackout>('booking_blackouts').list({
      where: b => occupancyIds.includes(b.resource_id) && b.day >= fromDay && b.day <= lastDay,
    }),
    table<Booking>('bookings').list({
      where: b => occupancyIds.includes(b.resource_id)
        && b.status !== 'cancelled'
        // a day either side covers resources sitting in other timezones
        && b.start_at >= fromEdge && b.start_at <= toEdge,
    }),
  ])

  // keyed by SPACE: closing the room under one of its names closes the room
  const blocked = new Set(
    blackouts
      .map(b => {
        const space = spaceById.get(b.resource_id)
        return space ? `${space}:${b.day}` : null
      })
      .filter((k): k is string => k !== null),
  )
  // What is taken, as local minute SPANS. A 2-hour session booked at 10:00
  // occupies 11:00 as well — carrying only its start time let a 1-hour
  // service be offered right through the middle of it.
  const takenBy = new Map<string, { start_min: number; end_min: number }[]>()
  for (const b of taken) {
    // keyed by SPACE: a booking made under the other name for this room
    // still occupies it, and used to be skipped here entirely
    const space = spaceById.get(b.resource_id)
    const tz = space ? tzBySpace.get(space) : undefined
    if (!space || !tz) continue
    const startLocal = utcToZoned(new Date(b.start_at), tz)
    const endAt = b.end_at ? new Date(b.end_at) : null
    const endLocal = endAt ? utcToZoned(endAt, tz) : null
    // an end past midnight is clamped to the day so it still blocks the
    // evening it actually occupies
    const endMin = !endLocal
      ? startLocal.minutes + 60
      : endLocal.day === startLocal.day ? endLocal.minutes : 1440
    const key = `${space}:${startLocal.day}`
    takenBy.set(key, [
      ...(takenBy.get(key) ?? []),
      { start_min: startLocal.minutes, end_min: Math.max(startLocal.minutes + 1, endMin) },
    ])
  }

  const now = Date.now()
  const earliest = now + service.lead_time_min * 60_000
  const horizonEnd = now + service.horizon_days * 86_400_000

  const out: DaySlots[] = []
  for (let i = 0; i < span; i++) {
    const day = addDays(fromDay, i)
    const wd = weekdayOf(day)
    if (wd === null) continue
    const bySlot = new Map<number, string>()   // minute → first free resource

    for (const res of resources) {
      if (blocked.has(`${spaceOf(res)}:${day}`)) continue
      const windows = hours
        .filter(h => h.resource_id === res.id && h.weekday === wd)
        .map(h => ({ start_min: h.start_min, end_min: h.end_min }))
      if (windows.length === 0) continue

      for (const min of openSlots({
        windows,
        durationMin: service.duration_min,
        capacity: service.capacity,
        taken: takenBy.get(`${spaceOf(res)}:${day}`) ?? [],
      })) {
        // lead time and horizon are real instants, not wall-clock guesses
        const at = zonedToUtc(day, min, res.timezone)
        if (!at) continue
        const t = at.getTime()
        if (t < earliest || t > horizonEnd) continue
        if (!bySlot.has(min)) bySlot.set(min, res.id)
      }
    }

    if (bySlot.size > 0) {
      out.push({
        day,
        slots: [...bySlot.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([min, resource_id]) => ({ min, label: minToLabel(min), resource_id })),
      })
    }
  }
  return out
}

/** Services listed on the public /events page — active, in display order. */
export async function listPublicServices(): Promise<PublicService[]> {
  const rows = await table<BookingService>('booking_services').list({
    by: { active: true },
    orderBy: [['sort_order', 'asc']],
  })
  return rows.map(r => withDefaults(r as unknown as Record<string, unknown>))
}

/**
 * The physical space a resource occupies — the port of the `bookings_fill_space`
 * trigger (docs/schema-history/booking_space.sql).
 *
 * A booking row carries the space so the no-overlap guarantee can read it
 * without a join. A resource with no space of its own IS its own space.
 */
export async function spaceForResource(resourceId: string): Promise<string> {
  const resource = await table<BookingResource>('booking_resources').get(resourceId)
  return resource?.space_id ?? resourceId
}

/**
 * The port of the `bookings_no_overlap` exclusion constraint
 * (docs/schema-history/booking_space.sql): no two live bookings for the same seat in the
 * same room may overlap in TIME.
 *
 * `[)` is half-open on purpose: a session ending at 11:00 and one starting at
 * 11:00 are back-to-back, not a clash.
 */
export async function seatIsFree(input: {
  spaceId: string
  seatNo: number | null
  startAt: string
  endAt: string
  excludeId?: string
}): Promise<boolean> {
  const clashes = await table<Booking>('bookings').list({
    // `fresh` is the whole point: callers reach here after several other
    // reads of this table inside one withRequestCache, and a seat check
    // answered from a cached copy of `bookings` is a check against the state
    // several round-trips ago — exactly the race this function exists to
    // close. It also drops the stale whole-table entry for later reads.
    fresh: true,
    where: b =>
      b.id !== input.excludeId
      && b.status !== 'cancelled'
      && (b.space_id ?? b.resource_id) === input.spaceId
      && (b.seat_no ?? null) === input.seatNo
      && b.start_at < input.endAt && b.end_at > input.startAt,
    limit: 1,
  })
  return clashes.length === 0
}

/**
 * The seat itself, as a row that can be claimed.
 *
 * `seatIsFree` above answers honestly about the moment it runs, and then the
 * booking is written — two operations, and two customers pressing Book in the
 * same second both pass the first one. Postgres closed that with an exclusion
 * constraint evaluated inside the insert; here the equivalent is a row of its
 * own: /mdm/tables/booking_seats/<space>__<seat> holds the time ranges that
 * seat is spoken for, and taking a range is ONE compare-and-set. A loser is
 * refused by the database, not by a check it happened to run first.
 *
 * The row is self-maintaining, which it has to be — a range left behind by a
 * cancelled booking would keep a bookable slot off the calendar forever:
 *  - ranges belonging to bookings that no longer exist, or are cancelled, are
 *    dropped;
 *  - but only once they are older than the snapshot that judged them, with a
 *    minute's grace, because a range added seconds ago may belong to a booking
 *    row that is still being written;
 *  - and every live booking with no range yet is seeded in, so bookings that
 *    predate this mechanism are honoured from the first claim.
 */
type SeatRange = { booking_id: string; start: string; end: string; at: string }
type SeatRow = { id: string; ranges?: SeatRange[] }

const seatKey = (spaceId: string, seatNo: number | null) => `${encodeKey(spaceId)}__${seatNo ?? 'x'}`
/** A range added within this window is too young for a stale snapshot to judge. */
const SEAT_GRACE_MS = 60_000

export type SeatClaim = {
  spaceId: string
  seatNo: number | null
  startAt: string
  endAt: string
  bookingId: string
}

/**
 * Take `[startAt, endAt)` on one seat for one booking, atomically.
 * `false` means somebody else holds an overlapping range — the port of
 * `bookings_no_overlap`. Half-open on purpose: 11:00–12:00 and 12:00–13:00 are
 * back-to-back, not a clash.
 */
export async function takeSeat(input: SeatClaim): Promise<boolean> {
  const { spaceId, seatNo, startAt, endAt, bookingId } = input
  const now = new Date().toISOString()
  const judgedBefore = new Date(Date.now() - SEAT_GRACE_MS).toISOString()

  // one fresh read of what really stands in this seat, used both to seed
  // ranges that were never recorded and to retire ranges that died
  const bookings = await table<Booking>('bookings').list({
    fresh: true,
    where: b => (b.space_id ?? b.resource_id) === spaceId && (b.seat_no ?? null) === seatNo,
  })
  // A session that has ENDED holds nothing. Keeping finished ranges would
  // grow this row without limit and, worse, make it slower and slower to
  // answer a question only about the future — so a past range is never kept
  // and a past booking is never seeded.
  const overBy = (endsAt: string | null | undefined) => (endsAt ?? '') <= now
  const live = new Map(
    bookings.filter(b => b.status !== 'cancelled' && !overBy(b.end_at ?? b.start_at)).map(b => [b.id, b]),
  )

  const claimed = await table<SeatRow>('booking_seats').claim(seatKey(spaceId, seatNo), cur => {
    const kept = (cur?.ranges ?? []).filter(r =>
      r.booking_id === bookingId ? false                 // our own hold, being replaced
        : overBy(r.end) ? false                          // the session is over
          : live.has(r.booking_id) ? true
            : r.at > judgedBefore ? true                 // too young to judge
              : false)                                   // its booking is gone or cancelled
    for (const b of live.values()) {
      if (b.id === bookingId || kept.some(r => r.booking_id === b.id)) continue
      kept.push({ booking_id: b.id, start: b.start_at, end: b.end_at ?? b.start_at, at: b.created_at ?? now })
    }
    if (kept.some(r => r.start < endAt && r.end > startAt)) return null
    return { id: seatKey(spaceId, seatNo), ranges: [...kept, { booking_id: bookingId, start: startAt, end: endAt, at: now }] }
  })
  return claimed.claimed
}

/** Give a seat range back — the booking that held it is gone. */
export async function releaseSeat(spaceId: string, seatNo: number | null, bookingId: string): Promise<void> {
  await table<SeatRow>('booking_seats').claim(seatKey(spaceId, seatNo), cur => {
    if (!cur?.ranges?.some(r => r.booking_id === bookingId)) return null
    return { ...cur, ranges: cur.ranges.filter(r => r.booking_id !== bookingId) }
  })
}

/**
 * Insert a booking with both database guarantees applied in code: the space is
 * filled from the resource, and an overlapping live booking for the same seat
 * is refused.
 *
 * Postgres enforced these with a trigger and a GiST exclusion constraint; the
 * Realtime Database has neither, so they live here — in ONE place, beside the
 * insert, so no caller can forget either of them. The refusal carries the
 * constraint's own name, so callers that already recognise
 * `bookings_no_overlap` keep working unchanged.
 */
export async function insertBooking(
  row: Omit<Partial<Booking>, 'id'> & {
    resource_id: string; start_at: string; end_at: string
  },
): Promise<Booking> {
  const space_id = row.space_id ?? await spaceForResource(row.resource_id)
  // the column defaults from docs/schema-history/booking.sql and booking_seats.sql —
  // Postgres supplied these, and seat_no in particular is half of the
  // no-overlap key, so a missing one would make every booking clash
  const seat_no = row.seat_no ?? 1
  // the id is minted here so the seat can be claimed BEFORE the booking
  // exists: the claim is what decides, and the row is what it decided about
  const id = crypto.randomUUID()
  const took = await takeSeat({
    spaceId: space_id, seatNo: seat_no, startAt: row.start_at, endAt: row.end_at, bookingId: id,
  })
  if (!took) throw new DbError('unique', 'bookings_no_overlap: that seat is already booked')
  try {
    return await table('bookings').insert({
      status: 'confirmed',
      payment_status: 'unpaid',
      amount_cents: 0,
      ...row,
      id,
      seat_no,
      space_id,
    }) as unknown as Booking
  } catch (e) {
    // never hold a seat for a booking that was not written
    await releaseSeat(space_id, seat_no, id).catch(() => {})
    throw e
  }
}

/**
 * Move a live booking to a new time — the one place all three move paths go
 * through (the dashboard, the customer's manage page, and a Stripe payment
 * arriving for a booking that was let go).
 *
 * Two conditional writes, no checks: the seat is claimed at the new time, and
 * the booking row is moved only if it is still live. A caller that finds
 * `clash` was refused by the seat; one that finds `not_live` was cancelled
 * underneath it. Each keeps its own wording for those.
 */
export async function moveBooking(
  bookingId: string, startAt: string, endAt: string,
): Promise<{ ok: true; booking: Booking } | { ok: false; reason: 'clash' | 'not_live' }> {
  const bookings = table<Booking>('bookings')
  const { row: current } = await bookings.getForUpdate(bookingId)
  if (!current || current.status === 'cancelled') return { ok: false, reason: 'not_live' }

  const spaceId = current.space_id ?? await spaceForResource(current.resource_id)
  const seatNo = current.seat_no ?? 1
  // the booking's own current range is replaced, so moving inside it is fine
  const took = await takeSeat({ spaceId, seatNo, startAt, endAt, bookingId })
  if (!took) return { ok: false, reason: 'clash' }

  const moved = await bookings.claim(bookingId, cur =>
    cur && cur.status !== 'cancelled' ? { ...cur, start_at: startAt, end_at: endAt } : null)
  if (!moved.claimed) {
    await releaseSeat(spaceId, seatNo, bookingId).catch(() => {})
    return { ok: false, reason: 'not_live' }
  }
  return { ok: true, booking: moved.row }
}
