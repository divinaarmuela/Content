import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { loadPublicService, availabilityFor } from '../../../../lib/booking'
import { zonedToUtc } from '../../../../lib/booking-core'
import { notifyNewBooking } from '../../../../lib/booking-notify'

/**
 * PUBLIC, unauthenticated: take a booking.
 *
 * The double-booking guard is the unique index, never a read-then-write: two
 * people clicking the same 10:00 slot both reach the insert, and exactly one
 * wins. The loser is told the slot just went, not handed a silent duplicate.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i

/** Booking references are shown to customers, so keep them unguessable. */
function publicRef(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9))
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Bad request' }, { status: 400 })
    }

    // bots fill every field they find; a human never sees this one
    if (String((body as { company?: unknown }).company ?? '').trim() !== '') {
      return NextResponse.json({ ok: true, ref: publicRef() })
    }

    const slug = String(body.slug ?? '').toLowerCase()
    const day = String(body.day ?? '')
    const min = Number(body.min)
    const name = String(body.name ?? '').replace(/[\r\n]/g, ' ').trim().slice(0, 80)
    const email = String(body.email ?? '').trim().toLowerCase().slice(0, 160)
    const phone = String(body.phone ?? '').replace(/[\r\n]/g, ' ').trim().slice(0, 40)
    const notes = String(body.notes ?? '').trim().slice(0, 1000)

    if (!name) return NextResponse.json({ error: 'Your name is required' }, { status: 422 })
    if (!EMAIL.test(email)) return NextResponse.json({ error: 'Enter a valid email address' }, { status: 422 })
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(min)) {
      return NextResponse.json({ error: 'Pick a time' }, { status: 422 })
    }

    const loaded = await loadPublicService(slug)
    if (!loaded) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const { service, resources } = loaded

    // one person cannot paper the calendar: a soft daily cap per email
    const since = new Date(Date.now() - 86_400_000).toISOString()
    const { count: recent } = await supabase
      .from('bookings').select('id', { count: 'exact', head: true })
      .eq('customer_email', email).gte('created_at', since).neq('status', 'cancelled')
    if ((recent ?? 0) >= 5) {
      return NextResponse.json(
        { error: 'That is a lot of bookings for one day — email us and we will sort it out.' },
        { status: 429 },
      )
    }

    // the offered slot is re-derived server-side; a hand-made request cannot
    // book outside opening hours, inside a blackout, or in the past
    const offered = await availabilityFor(service, resources, day, 1)
    const slot = offered.find(d => d.day === day)?.slots.find(s => s.min === min)
    if (!slot) {
      return NextResponse.json({ error: 'That time is no longer available' }, { status: 409 })
    }
    const resource = resources.find(r => r.id === slot.resource_id)
    if (!resource) return NextResponse.json({ error: 'That time is no longer available' }, { status: 409 })

    const startAt = zonedToUtc(day, min, resource.timezone)
    if (!startAt) return NextResponse.json({ error: 'Pick a time' }, { status: 422 })
    const endAt = new Date(startAt.getTime() + service.duration_min * 60_000)

    const needsPayment = service.requires_payment && service.price_cents > 0
    const ref = publicRef()
    const { data: booking, error } = await supabase.from('bookings').insert({
      service_id: service.id,
      resource_id: resource.id,
      start_at: startAt.toISOString(),
      end_at: endAt.toISOString(),
      customer_name: name,
      customer_email: email,
      customer_phone: phone || null,
      notes: notes || null,
      // an unpaid-but-required booking holds the slot only until it is paid
      status: needsPayment ? 'pending' : 'confirmed',
      payment_status: 'unpaid',
      amount_cents: service.price_cents,
      public_ref: ref,
    }).select('id, start_at, end_at, public_ref').single()

    if (error) {
      // 23505 = the unique index did its job: someone else took this slot
      if (/duplicate key|23505/.test(error.message)) {
        return NextResponse.json({ error: 'That time was just booked — please pick another' }, { status: 409 })
      }
      if (/column .* does not exist|public_ref/.test(error.message)) {
        return NextResponse.json(
          { error: 'Bookings are not switched on yet — run supabase/booking_public.sql' },
          { status: 503 },
        )
      }
      throw new Error(error.message)
    }

    // fire-and-forget: a mail hiccup must never lose a confirmed booking
    notifyNewBooking({
      booking: { ...booking, customer_name: name, customer_email: email, customer_phone: phone, notes },
      service, resource,
    }).catch(e => console.error('booking notify error:', e))

    return NextResponse.json({
      ok: true,
      ref: booking.public_ref,
      start_at: booking.start_at,
      requires_payment: needsPayment,
      booking_id: needsPayment ? booking.id : undefined,
    })
  } catch (e) {
    console.error('public booking error:', e)
    return NextResponse.json({ error: 'Something went wrong — try again' }, { status: 500 })
  }
}
