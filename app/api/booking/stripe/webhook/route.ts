import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { table, withRequestCache } from '@/lib/db'
import type { Booking, BookingResource, BookingService } from '@/lib/db-types'
import { seatIsFree, spaceForResource } from '../../../../lib/booking'
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

/**
 * The booking a Checkout Session belongs to: by the id Stripe carries in its
 * metadata, else by the session id we stored on the booking when the payment
 * was started. `checkout_ref` holds one booking per session — a second
 * delivery for the same session finds the same row, which is what keeps this
 * webhook idempotent.
 */
async function findBooking(session: Stripe.Checkout.Session): Promise<Booking | null> {
  const bookingId = session.metadata?.booking_id
  if (bookingId) return await table<Booking>('bookings').get(bookingId)
  return await table<Booking>('bookings')
    .list({ where: b => b.checkout_ref === session.id, limit: 1 })
    .then(r => r[0] ?? null)
}

/** Confirm the booking behind a paid session. Idempotent: Stripe retries. */
async function fulfil(session: Stripe.Checkout.Session) {
  // an unpaid session reaches us for delayed payment methods; it is not money
  if (session.payment_status === 'unpaid') return

  const booking = await findBooking(session)
  if (!booking) {
    console.error('stripe webhook: no booking for session', session.id)
    return
  }
  if (booking.payment_status === 'paid') return   // already done — a retry

  /**
   * A payment can land AFTER the hold was released.
   *
   * Someone pays at 30:50 while the session is still alive, but the webhook
   * arrives a couple of minutes later — by which time the sweep has freed
   * the slot. Leaving that as "cancelled but paid" charges a customer for
   * nothing, silently. So a paid booking tries to take its slot back, and
   * the seat rule decides whether it still can.
   */
  let reclaimed: 'held' | 'recovered' | 'lost' = 'held'
  if (booking.status === 'cancelled') {
    // the seat rule that used to be the exclusion constraint: it can only
    // come back if nobody else moved into the same seat and time
    const free = await seatIsFree({
      spaceId: booking.space_id ?? await spaceForResource(booking.resource_id),
      seatNo: booking.seat_no ?? 1,
      startAt: booking.start_at,
      endAt: booking.end_at,
      excludeId: booking.id,
    })
    reclaimed = free ? 'recovered' : 'lost'
    if (!free) console.error('paid booking could not reclaim its slot:', booking.id)
  }

  // re-read immediately before the write so two concurrent deliveries cannot
  // both "first" confirm
  const live = await table<Booking>('bookings').get(booking.id)
  if (!live || live.payment_status === 'paid') return
  await table<Booking>('bookings').update(booking.id, {
    payment_status: 'paid',
    status: reclaimed === 'lost' ? 'cancelled' : 'confirmed',
    payment_ref: typeof session.payment_intent === 'string' ? session.payment_intent : session.id,
  })

  if (reclaimed === 'lost') {
    // money taken, no slot to give: a person has to refund this, so say so
    // loudly rather than leaving a paid-and-cancelled row for someone to
    // notice weeks later
    await notifyPaymentWithoutSlot(booking, session)
    return
  }

  // the customer never got a confirmation while the booking was pending —
  // now that it is paid, send the same one a free booking would have had
  const [service, resource] = await Promise.all([
    booking.service_id
      ? table<BookingService>('booking_services').get(booking.service_id)
      : Promise.resolve(null),
    table<BookingResource>('booking_resources').get(booking.resource_id),
  ])
  if (service && resource) {
    await notifyNewBooking({
      booking, service: service as never, resource: resource as never,
    }).catch(e => console.error('paid booking notify:', e))
  }
}

/**
 * Someone paid for a slot that had already been given away. Nobody can fix
 * that automatically — it needs a human to refund or re-book — so it is
 * escalated by email instead of being written quietly to a row.
 */
async function notifyPaymentWithoutSlot(
  booking: { id: string; customer_name?: string; customer_email?: string; start_at: string; public_ref: string | null },
  session: Stripe.Checkout.Session,
) {
  const { notify, renderEmail, escapeHtml, noReplyAddress } = await import('../../../../lib/mailer')
  const when = new Date(booking.start_at).toLocaleString('en-AU', {
    timeZone: 'Australia/Melbourne',
    weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit',
  })
  const pi = typeof session.payment_intent === 'string' ? session.payment_intent : session.id
  for (const to of ['contact@mdmmarketing.com.au', 'tech@mdmmarketing.com.au']) {
    await notify({
      actorName: 'MD Media Bookings',
      actorEmail: noReplyAddress(),
      eventType: 'booking_paid_no_slot',
      entityType: 'booking',
      entityId: `${booking.id}#${to}`,
      recipientEmail: to,
      subject: 'ACTION NEEDED: payment taken but the slot was gone',
      bodyHtml: renderEmail(
        'A payment landed after the slot was released',
        `<p><strong>${escapeHtml(booking.customer_name ?? 'A customer')}</strong> (${escapeHtml(booking.customer_email ?? 'unknown')}) paid for <strong>${escapeHtml(when)}</strong>, but that time had already been taken by someone else.</p>` +
        `<p>They have been charged and have no booking. Refund the payment, or offer them another time.</p>` +
        `<p><strong>Stripe payment:</strong> ${escapeHtml(pi)}<br>` +
        `<strong>Booking reference:</strong> ${escapeHtml(booking.public_ref ?? booking.id)}</p>`,
      ),
    }).catch(e => console.error('paid-no-slot alert failed:', e))
  }
}

/** Payment failed after the fact — release the slot rather than hold it. */
async function releaseUnpaid(session: Stripe.Checkout.Session) {
  const booking = await findBooking(session)
  if (!booking) return
  if (booking.payment_status !== 'unpaid' || booking.status === 'cancelled') return
  await table<Booking>('bookings').update(booking.id, { status: 'cancelled' })
}

export async function POST(req: Request) {
 return withRequestCache(async () => {
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
 })
}
