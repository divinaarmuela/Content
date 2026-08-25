import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
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

    const { data: booking } = await supabase
      .from('bookings')
      .select('id, service_id, resource_id, start_at, status, payment_status, amount_cents, customer_email, customer_name, public_ref, checkout_ref')
      .eq('public_ref', ref).maybeSingle()
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

    const [{ data: service }, { data: resource }] = await Promise.all([
      supabase.from('booking_services').select('name, currency').eq('id', booking.service_id).maybeSingle(),
      supabase.from('booking_resources').select('timezone').eq('id', booking.resource_id).maybeSingle(),
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
      // where the browser lands afterwards; the webhook remains the source of
      // truth for whether the money actually arrived
      return_url: publicUrl(`/book/manage/${booking.public_ref}?paid=1`),
      metadata: { booking_id: booking.id, public_ref: booking.public_ref ?? '' },
    })

    // remember the session so the webhook can find its booking even if the
    // metadata is ever lost in a replay
    await supabase.from('bookings').update({ checkout_ref: session.id }).eq('id', booking.id)

    // the client secret is what mounts the embedded form; it is scoped to
    // this one session and is safe to hand to the browser
    return NextResponse.json({ client_secret: session.client_secret })
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
}
