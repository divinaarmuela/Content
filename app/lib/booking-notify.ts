import 'server-only'
import { supabase } from '@/lib/supabase'
import { notify, renderEmail, escapeHtml, noReplyAddress } from './mailer'
import type { PublicService, PublicResource } from './booking'

/**
 * Who hears about a booking.
 *
 * The customer gets a confirmation they can act on — the same link lets them
 * move or cancel it, so a change never depends on catching someone by phone.
 * The team gets told once: the mailbox that owns the slot, plus the shared
 * inbox that watches all of them.
 */

import { publicUrl, appUrl } from './site-urls'
/**
 * Who watches every booking, whoever it is with.
 *
 * A named list, not a role: bookings belong to the shared mailboxes and to
 * Martin, and most super admins have no business being paged about a podcast
 * slot. This matches the grant-only access on /dashboard/bookings.
 */
const WATCHERS: { email: string; mail: boolean }[] = [
  // these two run bookings day to day — they get the email
  { email: 'contact@mdmmarketing.com.au', mail: true },
  { email: 'tech@mdmmarketing.com.au', mail: true },
  // these two watch the page and want the bell, not a full inbox
  { email: 'hello@mdmmarketing.com.au', mail: false },
  { email: 'martin@mdmmarketing.com.au', mail: false },
]

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
  // a customer's link is the PUBLIC site — app.* is where staff sign in
  const manageUrl = booking.public_ref ? publicUrl(`/book/manage/${booking.public_ref}`) : null

  // ── the customer ──
  await notify({
    actorName: 'MD Media',
    // automated mail sends as no-reply@, never out of someone's mailbox;
    // replies still reach a human via the shared inbox
    actorEmail: noReplyAddress(),
    replyTo: 'contact@mdmmarketing.com.au',
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
  const recipients = watcherList(resource.id ? await resourceEmail(resource.id) : null)

  for (const { email: to, mail } of recipients) {
    await notify({
      actorName: 'MD Media Bookings',
      actorEmail: noReplyAddress(),
      replyTo: booking.customer_email,
      eventType: 'booking_new_team',
      entityType: 'booking',
      entityId: `${booking.id}#${to}`,
      // the id is what puts it in their notification bell, not just their inbox
      recipientId: await teamUserIdFor(to),
      recipientEmail: to,
      bellOnly: !mail,
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
        appUrl('/dashboard/bookings'),
      ),
    }).catch(e => console.error('booking team mail:', e))
  }
}

/** The watch list, with the studio's own mailbox folded in (it always gets
 *  the email — it is the one turning up to the session). */
function watcherList(resourceMailbox: string | null): { email: string; mail: boolean }[] {
  const out = [...WATCHERS]
  const extra = resourceMailbox?.trim().toLowerCase()
  if (extra && !out.some(w => w.email.toLowerCase() === extra)) {
    out.unshift({ email: extra, mail: true })
  }
  return out
}

async function resourceEmail(resourceId: string): Promise<string | null> {
  const { data } = await supabase.from('booking_resources').select('email').eq('id', resourceId).maybeSingle()
  return data?.email ?? null
}

/**
 * The team_user behind a mailbox, so the in-app bell shows the booking too.
 *
 * The notifications page reads notification_log by recipient_id — an email
 * with no id lands in the inbox but never in the bell, which is exactly the
 * kind of "I never saw it" gap bookings cannot afford.
 */
async function teamUserIdFor(email: string): Promise<string | null> {
  const { data } = await supabase.from('team_users')
    .select('id').ilike('email', email).eq('active_status', true).maybeSingle()
  return data?.id ?? null
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
  const everyone = [
    { email: booking.customer_email, mail: true },
    ...watcherList(teamEmail),
  ].filter(r => r.email !== booking.customer_email || r.mail)

  const seen = new Set<string>()
  for (const { email: to, mail } of everyone) {
    if (seen.has(to)) continue
    seen.add(to)
    const isCustomer = to === booking.customer_email
    await notify({
      actorName: 'MD Media Bookings',
      actorEmail: noReplyAddress(),
      replyTo: isCustomer ? 'contact@mdmmarketing.com.au' : booking.customer_email,
      eventType: cancelled ? 'booking_cancelled' : 'booking_moved',
      entityType: 'booking',
      entityId: `${booking.id}#${stamp}#${to}`,
      recipientId: isCustomer ? null : await teamUserIdFor(to),
      recipientEmail: to,
      bellOnly: !mail,
      subject: title,
      bodyHtml: renderEmail(
        title,
        (isCustomer ? '' : `<p><strong>${escapeHtml(booking.customer_name)}</strong> (${escapeHtml(booking.customer_email)}):</p>`) + detail,
        isCustomer ? undefined : 'Open the bookings page',
        isCustomer ? undefined : appUrl('/dashboard/bookings'),
      ),
    }).catch(e => console.error('booking change mail:', e))
  }
}
