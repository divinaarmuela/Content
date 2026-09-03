import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Booking, BookingResource, BookingService } from '@/lib/db-types'
import {
  loadPublicService, availabilityFor, seatIsFree, spaceForResource, type PublicResource,
} from '../../../../lib/booking'
import { zonedToUtc, utcToZoned, policyFor } from '../../../../lib/booking-core'
import { notifyBookingChanged } from '../../../../lib/booking-notify'
import { announceBookingChange } from '../../../../lib/production-live'

/**
 * PUBLIC: a customer managing their own booking.
 *
 * The reference in their confirmation email is the key — unguessable and
 * scoped to one booking, the same bearer model as a client portal link. It
 * never lists other bookings and never reveals a resource's email.
 */

const REF = /^[0-9a-f]{18}$/

async function load(ref: string) {
  if (!REF.test(ref)) return null
  const data = await table<Booking>('bookings')
    .list({ where: b => b.public_ref === ref, limit: 1 })
    .then(r => r[0] ?? null)
  if (!data) return null
  const [svc, res] = await Promise.all([
    data.service_id
      ? table<BookingService>('booking_services').get(data.service_id)
      : Promise.resolve(null),
    table<BookingResource>('booking_resources').get(data.resource_id),
  ])
  if (!svc || !res) return null
  return { booking: data, svc, resource: res as unknown as PublicResource }
}

export async function GET(req: Request) {
 return withRequestCache(async () => {
  try {
    const ref = String(new URL(req.url).searchParams.get('ref') ?? '')
    const found = await load(ref)
    if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const { booking, svc, resource } = found

    // the alternatives on offer, from the same service and the same person
    let availability: Awaited<ReturnType<typeof availabilityFor>> = []
    const loaded = await loadPublicService(svc.slug)
    if (loaded && booking.status !== 'cancelled') {
      const all = await availabilityFor(
        loaded.service,
        loaded.resources.filter(r => r.id === resource.id),
        new Date().toISOString().slice(0, 10),
        21,
      )
      availability = all
    }

    const local = utcToZoned(new Date(booking.start_at), resource.timezone)
    return NextResponse.json({
      booking: {
        ref: booking.public_ref,
        status: booking.status,
        start_at: booking.start_at,
        customer_name: booking.customer_name,
        day: local.day,
        min: local.minutes,
      },
      service: { name: svc.name, duration_min: svc.duration_min, slug: svc.slug },
      policy: policyFor(booking.start_at),
      resource: { label: resource.label, timezone: resource.timezone },
      availability,
    })
  } catch (e) {
    console.error('booking manage read error:', e)
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 })
  }
 })
}

export async function POST(req: Request) {
 return withRequestCache(async () => {
  try {
    const body = await req.json().catch(() => null)
    const ref = String((body as { ref?: unknown })?.ref ?? '')
    const action = String((body as { action?: unknown })?.action ?? '')
    const found = await load(ref)
    if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const { booking, svc, resource } = found

    if (booking.status === 'cancelled') {
      return NextResponse.json({ error: 'That booking is already cancelled' }, { status: 409 })
    }
    // the cancellation policy decides what is still allowed, and it is
    // enforced here — the page explaining it is not a control
    const policy = policyFor(booking.start_at)

    if (action === 'cancel') {
      if (!policy.canCancel) {
        return NextResponse.json({ error: policy.reason }, { status: 409 })
      }
      // only a live booking can be cancelled, and exactly once — the state is
      // re-read immediately before the write rather than guarded by it
      const live = await table<Booking>('bookings').get(booking.id, { fresh: true })
      if (!live || live.status === 'cancelled') {
        return NextResponse.json({ error: 'That booking is already cancelled' }, { status: 409 })
      }
      await table<Booking>('bookings').update(booking.id, { status: 'cancelled' })

      announceBookingChange({ booking_id: booking.id, kind: 'cancelled' })
      notifyBookingChanged({
        booking: { ...booking, public_ref: booking.public_ref },
        service: svc, resource, previousStart: booking.start_at, cancelled: true,
      }).catch(e => console.error('cancel notify:', e))
      return NextResponse.json({ ok: true, status: 'cancelled' })
    }

    if (action !== 'move') return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    if (!policy.canReschedule) {
      return NextResponse.json({ error: policy.reason }, { status: 409 })
    }

    const day = String((body as { day?: unknown })?.day ?? '')
    const min = Number((body as { min?: unknown })?.min)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(min)) {
      return NextResponse.json({ error: 'Pick a new time' }, { status: 422 })
    }

    // the new time is re-derived server-side, exactly like a fresh booking
    const loaded = await loadPublicService(svc.slug)
    if (!loaded) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const offered = await availabilityFor(
      loaded.service, loaded.resources.filter(r => r.id === resource.id), day, 1,
    )
    if (!offered.find(d => d.day === day)?.slots.some(s => s.min === min)) {
      return NextResponse.json({ error: 'That time is not available' }, { status: 409 })
    }

    const startAt = zonedToUtc(day, min, resource.timezone)
    if (!startAt) return NextResponse.json({ error: 'Pick a new time' }, { status: 422 })
    const endAt = new Date(startAt.getTime() + (svc.duration_min as number) * 60_000)
    const previousStart = booking.start_at

    // the no-overlap rule Postgres enforced with an exclusion constraint: the
    // seat this booking already holds must be free at the NEW time, ignoring
    // the booking's own current slot
    const free = await seatIsFree({
      spaceId: booking.space_id ?? await spaceForResource(booking.resource_id),
      seatNo: booking.seat_no ?? 1,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      excludeId: booking.id,
    })
    if (!free) {
      return NextResponse.json({ error: 'That time was just taken — pick another' }, { status: 409 })
    }
    const live = await table<Booking>('bookings').get(booking.id, { fresh: true })
    if (!live || live.status === 'cancelled') {
      return NextResponse.json({ error: 'That booking is no longer live' }, { status: 409 })
    }
    const moved = await table<Booking>('bookings')
      .update(booking.id, { start_at: startAt.toISOString(), end_at: endAt.toISOString() })
    if (!moved) return NextResponse.json({ error: 'That booking is no longer live' }, { status: 409 })

    announceBookingChange({ booking_id: booking.id, kind: 'moved' })
    notifyBookingChanged({
      booking: { ...booking, start_at: moved.start_at, public_ref: moved.public_ref },
      service: svc, resource, previousStart,
    }).catch(e => console.error('move notify:', e))
    return NextResponse.json({ ok: true, start_at: moved.start_at })
  } catch (e) {
    console.error('booking manage error:', e)
    return NextResponse.json({ error: 'Something went wrong — try again' }, { status: 500 })
  }
 })
}
