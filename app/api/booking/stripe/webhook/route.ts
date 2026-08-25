import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { supabase } from '@/lib/supabase'
import { stripeClient, STRIPE_WEBHOOK_SECRET } from '../../../../lib/stripe'
import { notifyNewBooking } from '../../../../lib/booking-notify'

/**
 * Stripe webhook — THIS project's bookings only.
 *
 * The path is deliberately scoped (/api/booking/stripe/webhook): other
 * projects on this Stripe account have their own endpoints, and a shared
 * path would have them fighting over each other's events. Point a dedicated
 * endpoint at this URL and give it its own signing secret
 * (STRIPE_BOOKING_WEBHOOK_SECRET) — never reuse another endpoint's.
 *
 * Fulfilment lives here, not on the return page: a customer can pay and lose
 * their connection before any page loads, and that booking must still be
 * confirmed.
 */

// the signature is computed over the RAW body — never let a framework parse it
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Confirm the booking behind a paid session. Idempotent: Stripe retries. */
async function fulfil(session: Stripe.Checkout.Session) {
  // an unpaid session reaches us for delayed payment methods; it is not money
  if (session.payment_status === 'unpaid') return

  const bookingId = session.metadata?.booking_id
  const query = bookingId
    ? supabase.from('bookings').select('id, status, payment_status, service_id, resource_id, start_at, end_at, customer_name, customer_email, customer_phone, notes, public_ref').eq('id', bookingId)
    : supabase.from('bookings').select('id, status, payment_status, service_id, resource_id, start_at, end_at, customer_name, customer_email, customer_phone, notes, public_ref').eq('checkout_ref', session.id)
  const { data: booking } = await query.maybeSingle()
  if (!booking) {
    console.error('stripe webhook: no booking for session', session.id)
    return
  }
  if (booking.payment_status === 'paid') return   // already done — a retry

  // optimistic guard so two concurrent deliveries cannot both "first" confirm
  const { data: claimed } = await supabase.from('bookings')
    .update({
      payment_status: 'paid',
      status: booking.status === 'cancelled' ? 'cancelled' : 'confirmed',
      payment_ref: typeof session.payment_intent === 'string' ? session.payment_intent : session.id,
    })
    .eq('id', booking.id).neq('payment_status', 'paid')
    .select('id').maybeSingle()
  if (!claimed) return

  // the customer never got a confirmation while the booking was pending —
  // now that it is paid, send the same one a free booking would have had
  const [{ data: service }, { data: resource }] = await Promise.all([
    supabase.from('booking_services')
      .select('id, name, slug, description, duration_min, price_cents, currency, resource_id, lead_time_min, horizon_days, requires_payment')
      .eq('id', booking.service_id).maybeSingle(),
    supabase.from('booking_resources').select('id, label, timezone').eq('id', booking.resource_id).maybeSingle(),
  ])
  if (service && resource) {
    await notifyNewBooking({
      booking, service: service as never, resource: resource as never,
    }).catch(e => console.error('paid booking notify:', e))
  }
}

/** Payment failed after the fact — release the slot rather than hold it. */
async function releaseUnpaid(session: Stripe.Checkout.Session) {
  const bookingId = session.metadata?.booking_id
  const match = bookingId
    ? supabase.from('bookings').update({ status: 'cancelled' }).eq('id', bookingId)
    : supabase.from('bookings').update({ status: 'cancelled' }).eq('checkout_ref', session.id)
  await match.eq('payment_status', 'unpaid').neq('status', 'cancelled')
}

export async function POST(req: Request) {
  const stripe = stripeClient()
  const secret = STRIPE_WEBHOOK_SECRET()
  if (!stripe || !secret) {
    // not configured on this deployment — say so without leaking why
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }

  const signature = req.headers.get('stripe-signature')
  if (!signature) return NextResponse.json({ error: 'Missing signature' }, { status: 400 })

  let event: Stripe.Event
  try {
    const raw = await req.text()
    // verifying the signature is what makes this endpoint safe to expose:
    // anyone can POST here, only Stripe can sign
    event = stripe.webhooks.constructEvent(raw, signature, secret)
  } catch (e) {
    console.error('stripe webhook signature rejected:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  try {
    switch (event.type) {
      // both matter: the second is how delayed payment methods land
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        await fulfil(event.data.object as Stripe.Checkout.Session)
        break
      case 'checkout.session.async_payment_failed':
      case 'checkout.session.expired':
        await releaseUnpaid(event.data.object as Stripe.Checkout.Session)
        break
      default:
        break   // everything else is another integration's business
    }
    return NextResponse.json({ received: true })
  } catch (e) {
    // a 500 makes Stripe retry, which is what we want for a transient fault
    console.error('stripe webhook handler error:', e)
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 })
  }
}
