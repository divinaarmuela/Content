import 'server-only'
import { supabase } from '@/lib/supabase'
import { notify, renderEmail, escapeHtml } from './mailer'
import type { PublicService, PublicResource } from './booking'

/**
 * Who hears about a booking.
 *
 * The customer gets a confirmation they can act on — the same link lets them
 * move or cancel it, so a change never depends on catching someone by phone.
 * The team gets told once: the mailbox that owns the slot, plus the shared
 * inbox that watches all of them.
 */

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.mdmmarketing.com.au'
/** The shared inbox that sees every booking, whoever it is with. */
const WATCH_INBOX = 'contact@mdmmarketing.com.au'

export type BookingRow = {
  id: string
  start_at: string
  end_at?: string
  public_ref: string | null
  customer_name: string
  customer_email: string
  customer_phone?: string | null
  notes?: string | null
}

function whenLabel(startAt: string, timeZone: string): string {
  return new Date(startAt).toLocaleString('en-AU', {
    timeZone, weekday: 'long', day: 'numeric', month: 'long',
    hour: 'numeric', minute: '2-digit',
  })
}

const money = (cents: number, currency: string) =>
  cents > 0 ? `${currency} $${(cents / 100).toFixed(2)}` : 'Free'

/** Confirmation to the customer + an alert to the team. Never throws. */
export async function notifyNewBooking(input: {
  booking: BookingRow
  service: PublicService
  resource: PublicResource
}) {
  const { booking, service, resource } = input
  const when = whenLabel(booking.start_at, resource.timezone)
  const manageUrl = booking.public_ref ? `${APP_URL}/book/manage/${booking.public_ref}` : null

  // ── the customer ──
  await notify({
    actorName: 'MD Media',
    eventType: 'booking_confirmed',
    entityType: 'booking',
    entityId: `${booking.id}#customer`,
    recipientEmail: booking.customer_email,
    subject: `Booking confirmed: ${service.name} — ${when}`,
    bodyHtml: renderEmail(
      `You're booked in`,
      `<p>Thanks ${escapeHtml(booking.customer_name)} — your <strong>${escapeHtml(service.name)}</strong> is confirmed.</p>` +
      `<p><strong>When:</strong> ${escapeHtml(when)}<br>` +
      `<strong>How long:</strong> ${service.duration_min} minutes<br>` +
      `<strong>Cost:</strong> ${escapeHtml(money(service.price_cents, service.currency))}</p>` +
      (booking.public_ref ? `<p><strong>Your reference:</strong> ${escapeHtml(booking.public_ref)}</p>` : '') +
      `<p>Need a different time? Use the link below to move or cancel it yourself.</p>`,
      manageUrl ? 'Move or cancel this booking' : undefined,
      manageUrl ?? undefined,
    ),
  }).catch(e => console.error('booking customer mail:', e))

  // ── the team: the mailbox that owns the slot, plus the shared inbox ──
  const recipients = [...new Set([resource.id ? await resourceEmail(resource.id) : null, WATCH_INBOX]
    .filter((e): e is string => Boolean(e)))]

  for (const to of recipients) {
    await notify({
      actorName: 'MD Media Bookings',
      eventType: 'booking_new_team',
      entityType: 'booking',
      entityId: `${booking.id}#${to}`,
      recipientEmail: to,
      subject: `New booking: ${service.name} — ${when}`,
      bodyHtml: renderEmail(
        `New booking: ${service.name}`,
        `<p><strong>${escapeHtml(booking.customer_name)}</strong> booked <strong>${escapeHtml(service.name)}</strong>.</p>` +
        `<p><strong>When:</strong> ${escapeHtml(when)}<br>` +
        `<strong>With:</strong> ${escapeHtml(resource.label)}<br>` +
        `<strong>Email:</strong> ${escapeHtml(booking.customer_email)}` +
        (booking.customer_phone ? `<br><strong>Phone:</strong> ${escapeHtml(booking.customer_phone)}` : '') +
        `<br><strong>Cost:</strong> ${escapeHtml(money(service.price_cents, service.currency))}</p>` +
        (booking.notes ? `<p><strong>Their notes:</strong><br>${escapeHtml(booking.notes).replace(/\n/g, '<br>')}</p>` : ''),
        'Open the bookings page',
        `${APP_URL}/dashboard/bookings`,
      ),
    }).catch(e => console.error('booking team mail:', e))
  }
}

async function resourceEmail(resourceId: string): Promise<string | null> {
  const { data } = await supabase.from('booking_resources').select('email').eq('id', resourceId).maybeSingle()
  return data?.email ?? null
}

/** The customer moved their own booking — tell them and the team. */
export async function notifyBookingChanged(input: {
  booking: BookingRow
  service: { name: string; duration_min: number }
  resource: PublicResource
  previousStart: string
  cancelled?: boolean
}) {
  const { booking, service, resource, previousStart, cancelled } = input
  const was = whenLabel(previousStart, resource.timezone)
  const now = whenLabel(booking.start_at, resource.timezone)
  const title = cancelled ? `Booking cancelled: ${service.name}` : `Booking moved: ${service.name}`
  const detail = cancelled
    ? `<p>Your <strong>${escapeHtml(service.name)}</strong> on ${escapeHtml(was)} has been cancelled.</p>`
    : `<p>Your <strong>${escapeHtml(service.name)}</strong> has moved.</p>` +
      `<p><strong>Was:</strong> ${escapeHtml(was)}<br><strong>Now:</strong> ${escapeHtml(now)}</p>`

  const stamp = Date.now()
  const teamEmail = await resourceEmail(resource.id)
  const everyone = [...new Set([booking.customer_email, teamEmail, WATCH_INBOX]
    .filter((e): e is string => Boolean(e)))]

  for (const to of everyone) {
    const isCustomer = to === booking.customer_email
    await notify({
      actorName: 'MD Media Bookings',
      eventType: cancelled ? 'booking_cancelled' : 'booking_moved',
      entityType: 'booking',
      entityId: `${booking.id}#${stamp}#${to}`,
      recipientEmail: to,
      subject: title,
      bodyHtml: renderEmail(
        title,
        (isCustomer ? '' : `<p><strong>${escapeHtml(booking.customer_name)}</strong> (${escapeHtml(booking.customer_email)}):</p>`) + detail,
        isCustomer ? undefined : 'Open the bookings page',
        isCustomer ? undefined : `${APP_URL}/dashboard/bookings`,
      ),
    }).catch(e => console.error('booking change mail:', e))
  }
}
