import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Booking, BookingResource, BookingService } from '@/lib/db-types'
import { stripeClient, stripeReady } from '../../../../lib/stripe'

/**
 * PUBLIC: start payment for a booking that requires it.
 *
 * The booking already exists as `pending` and is holding the slot — this
 * only attaches a Checkout Session to it. Nothing here confirms anything:
 * confirmation happens in the webhook, because a customer can pay and then
 * close the tab before any return page loads.
 */

import { publicUrl } from '../../../../lib/site-urls'
const REF = /^[0-9a-f]{18}$/

export async function POST(req: Request) {
 return withRequestCache(async () => {
  try {
    if (!stripeReady()) {
      return NextResponse.json(
        { error: 'Card payment is not switched on yet — contact us and we will take payment another way.' },
        { status: 503 },
      )
    }
    const body = await req.json().catch(() => null)
    const ref = String((body as { ref?: unknown })?.ref ?? '')
    if (!REF.test(ref)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const booking = await table<Booking>('bookings')
      .list({ where: b => b.public_ref === ref, limit: 1 })
      .then(r => r[0] ?? null)
    if (!booking) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (booking.status === 'cancelled') {
      return NextResponse.json({ error: 'That booking was cancelled' }, { status: 409 })
    }
    if (booking.payment_status === 'paid') {
      return NextResponse.json({ error: 'That booking is already paid' }, { status: 409 })
    }
    if (!booking.amount_cents || booking.amount_cents <= 0) {
      return NextResponse.json({ error: 'Nothing to pay' }, { status: 400 })
    }

    const [service, resource] = await Promise.all([
      booking.service_id
        ? table<BookingService>('booking_services').get(booking.service_id)
        : Promise.resolve(null),
      table<BookingResource>('booking_resources').get(booking.resource_id),
    ])
    // This runs on a server in UTC. Formatting a time without naming the zone
    // showed an 11am Melbourne booking as "1:00 am" on Stripe's checkout —
    // the one screen the customer stares at while deciding to pay.
    const timeZone = resource?.timezone || 'Australia/Melbourne'

    const stripe = stripeClient()!
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      // no payment_method_types: dynamic payment methods pick what converts
      // best for this customer, managed from the Stripe Dashboard
      customer_email: booking.customer_email,
      client_reference_id: booking.public_ref ?? booking.id,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: (service?.currency ?? 'AUD').toLowerCase(),
          unit_amount: booking.amount_cents,
          product_data: {
            name: service?.name ?? 'Booking',
            description: new Date(booking.start_at).toLocaleString('en-AU', {
              timeZone,
              weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit',
            }),
          },
        },
      }],
      // embedded: the payment form renders INSIDE our booking page rather
      // than sending the customer to a Stripe-hosted page. Stripe still owns
      // the card fields (so PCI scope and 3-D Secure stay theirs) and dynamic
      // payment methods — Apple Pay, Google Pay, Link — still apply.
      // 'embedded_page' on this API version — the value was 'embedded' on
      // older ones, and passing that is rejected outright
      ui_mode: 'embedded_page',
      // An unpaid booking HOLDS the slot, so an abandoned checkout must not
      // hold it all day. 30 minutes is Stripe's floor and plenty to finish
      // paying; on expiry the webhook releases the time for someone else.
      // 31, not 30: Stripe requires "at least 30 minutes in the future", and
      // the request takes time to reach them — an exact 30 lands just under
      // the floor and the whole session is rejected.
      expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
      // Confirm in place. Sending someone to another page after paying makes
      // a finished booking feel unfinished, and dropped them on the manage
      // screen — which reads like an admin console, not a receipt.
      redirect_on_completion: 'never',
      metadata: { booking_id: booking.id, public_ref: booking.public_ref ?? '' },
    })

    // remember the session so the webhook can find its booking even if the
    // metadata is ever lost in a replay
    await table<Booking>('bookings').update(booking.id, { checkout_ref: session.id })

    // the client secret mounts the form; the expiry lets the page count down
    // and offer a way forward instead of leaving a dead form on screen
    return NextResponse.json({
      client_secret: session.client_secret,
      expires_at: session.expires_at ?? null,
    })
  } catch (e) {
    // Stripe's own error code is safe to surface (it names the rejected
    // parameter, not any secret) and is the difference between a fixable
    // report and "it doesn't work"
    const err = e as { code?: string; param?: string; type?: string; message?: string }
    console.error('booking checkout error:', err?.type, err?.code, err?.param, err?.message)
    return NextResponse.json({
      error: 'Could not start payment — try again',
      ...(err?.code || err?.param ? { detail: [err.type, err.code, err.param].filter(Boolean).join(' / ') } : {}),
    }, { status: 500 })
  }
 })
}
