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

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.mdmmarketing.com.au'
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
      .select('id, service_id, start_at, status, payment_status, amount_cents, customer_email, customer_name, public_ref, checkout_ref')
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

    const { data: service } = await supabase
      .from('booking_services').select('name, currency').eq('id', booking.service_id).maybeSingle()

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
              weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit',
            }),
          },
        },
      }],
      // the webhook is the source of truth; these only steer the browser
      success_url: `${APP_URL}/book/manage/${booking.public_ref}?paid=1`,
      cancel_url: `${APP_URL}/book/manage/${booking.public_ref}`,
      metadata: { booking_id: booking.id, public_ref: booking.public_ref ?? '' },
    })

    // remember the session so the webhook can find its booking even if the
    // metadata is ever lost in a replay
    await supabase.from('bookings').update({ checkout_ref: session.id }).eq('id', booking.id)

    return NextResponse.json({ url: session.url })
  } catch (e) {
    console.error('booking checkout error:', e)
    return NextResponse.json({ error: 'Could not start payment — try again' }, { status: 500 })
  }
}
