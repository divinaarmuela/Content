import 'server-only'
import { createHash } from 'node:crypto'
import { table } from '@/lib/db'
import type { Lead } from '@/lib/db-types'
import {
  BOOKING_BLOCK_TO, BOOKING_DETAILS_TO, bookingDetails, bookingIcs, bookingPatch, bookingSlot, bookingUids, inviteeId, signingKey,
  type Booking, type BookingDetails,
} from './calendly-core'
import { escapeHtml, noReplyAddress, notify, renderEmail } from './mailer'
import type { CalEvent } from './bookings-core'
import { logLeadEvent } from './lead-events'
import { callWords } from './lead-timeline-core'

/**
 * CALENDLY → LEADS, the I/O half (9 Nov 2026). Pure rules: calendly-core.ts.
 * CALENDLY_TOKEN (personal access token, set in Vercel by the owner) is used ONLY to create the webhook subscription;
 * the webhook's signing key is derived from MD_SECRET, so nothing else needs storing.
 */
const API = 'https://api.calendly.com'

export function calendlyKey(): string | null {
  const s = process.env.MD_SECRET?.trim()
  return s ? signingKey(s) : null
}

async function cal(path: string, init: RequestInit = {}): Promise<any> {
  const token = process.env.CALENDLY_TOKEN?.trim()
  if (!token) throw new Error('CALENDLY_TOKEN is not set in Vercel')
  const r = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) }, cache: 'no-store' })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`Calendly ${r.status}: ${j?.message ?? j?.title ?? 'request failed'}${j?.details ? ' — ' + JSON.stringify(j.details) : ''}`)
  return j
}

/**
 * Every call ever booked on this Calendly user (the Bookings tab on Leads, 11 Nov 2026). Read only. Calendly pages
 * 100 at a time; capped at 50 pages (5,000 bookings) so a runaway loop cannot hang the request.
 */
export async function listBookings(): Promise<CalEvent[]> {
  const me = (await cal('/users/me')).resource
  const out: CalEvent[] = []
  let token: string | null = null
  for (let page = 0; page < 50; page++) {
    const q = new URLSearchParams({ user: me.uri, count: '100', sort: 'start_time:desc' })
    if (token) q.set('page_token', token)
    const j = await cal(`/scheduled_events?${q}`)
    for (const e of j.collection ?? []) {
      out.push({
        name: String(e.name ?? 'Call'),
        status: e.status === 'canceled' ? 'canceled' : 'active',
        created_at: String(e.created_at ?? e.start_time ?? ''),
        start_time: String(e.start_time ?? ''),
      })
    }
    token = j.pagination?.next_page_token ?? null
    if (!token) break
  }
  return out
}

/** subscribe (once) to bookings and cancellations, pointing at our webhook. Safe to press twice. */
export async function connectCalendly(origin: string): Promise<{ created: boolean; url: string }> {
  const key = calendlyKey()
  if (!key) throw new Error('MD_SECRET is not set in Vercel')
  const me = (await cal('/users/me')).resource
  const url = `${origin}/api/calendly/webhook`
  const q = new URLSearchParams({ organization: me.current_organization, user: me.uri, scope: 'user' })
  const existing = (await cal(`/webhook_subscriptions?${q}`)).collection ?? []
  for (const w of existing) {
    if (w.callback_url !== url) continue
    // an older subscription to this URL may carry a different key; replace it so signatures check out
    await cal(`/webhook_subscriptions/${String(w.uri).split('/').pop()}`, { method: 'DELETE' })
  }
  await cal('/webhook_subscriptions', {
    method: 'POST',
    body: JSON.stringify({ url, events: ['invitee.created', 'invitee.canceled', 'invitee_no_show.created', 'invitee_no_show.deleted'], organization: me.current_organization, user: me.uri, scope: 'user', signing_key: key }),
  })
  return { created: true, url }
}

/**
 * Write a booking onto its lead: the lead holding this Calendly invitee, else the newest lead with this email, else a
 * new lead whose id is derived from the email — claim() makes two webhooks for one new person create ONE lead.
 */
export async function applyBooking(b: Booking, now = new Date()): Promise<{ id: string; created: boolean }> {
  const leads = table<Lead>('leads')
  const byUri = await leads.list({ by: { booking_uri: b.inviteeUri }, fresh: true })
  if (b.kind === 'no_show' || b.kind === 'showed') {
    // a no-show mark only names the booking; the lead is the one holding it
    const lead = byUri[0]
    if (!lead) return { id: '', created: false }
    await leads.update(lead.id, bookingPatch(b, lead, now.toISOString()) as Partial<Lead>)
    await logLeadEvent({
      leadId: lead.id, kind: b.kind, at: now.toISOString(), key: `${b.kind}|${b.inviteeUri}|${now.toISOString().slice(0, 16)}`,
      title: b.kind === 'no_show' ? `Missed ${lead.booking_event ?? 'their call'}` : 'No-show mark removed: they did attend',
    })
    return { id: lead.id, created: false }
  }
  const byEmail = byUri.length ? [] : await leads.list({ where: l => (l.email ?? '').toLowerCase() === b.email, orderBy: [['created_at', 'desc']], fresh: true })
  const found = byUri[0] ?? byEmail[0]
  if (found) {
    await leads.update(found.id, bookingPatch(b, found, now.toISOString()) as Partial<Lead>)
    await logBooking(found.id, b, !!found.booking_status && found.booking_uri !== b.inviteeUri, now)
    return { id: found.id, created: false }
  }
  // plain letters and digits only — an id with `@`/`%` in it broke the lead's page URL (9 Nov 2026)
  const id = `cal_${createHash('sha256').update(b.email).digest('hex').slice(0, 24)}`
  const res = await leads.claim(id, current => {
    const base = current ?? ({ id, created_at: now.toISOString(), email: b.email } as Lead)
    return { ...base, ...bookingPatch(b, current, now.toISOString()) } as Lead
  })
  await logBooking(id, b, false, now)
  return { id, created: res.claimed && !byEmail.length }
}

/** the booking's line on the lead's timeline; one per Calendly invitee per kind, however often Calendly retries */
async function logBooking(leadId: string, b: Booking, again: boolean, now: Date) {
  const kind = b.kind === 'cancelled' ? 'cancelled' : again ? 'rebooked' : 'booked'
  const what = b.event ?? 'a call'
  await logLeadEvent({
    leadId, kind, at: now.toISOString(), key: `${kind}|${b.inviteeUri}`,
    title: kind === 'cancelled' ? `Cancelled ${what}` : kind === 'rebooked' ? `Booked again: ${what}` : `Booked ${what}`,
    detail: b.startsAt ? `For ${callWords(b.startsAt)}` : null,
    meta: { utm_source: b.utm.source, utm_medium: b.utm.medium, utm_campaign: b.utm.campaign, utm_term: b.utm.term, utm_content: b.utm.content, page: b.page },
  })
}

/**
 * THE DETAILS EMAIL'S BODY (the owner, 12 Nov 2026: "please design it properly"). Who and when first, big enough to
 * read at a glance on a phone; then how to reach them, each one a link; then every question with its answer in its
 * own box. Inline styles only — mail clients drop everything else.
 */
export function bookingDetailsHtml(d: BookingDetails): string {
  const NL = String.fromCharCode(10)
  const val = (label: string) => d.rows.find(([k]) => k === label)?.[1] ?? null
  const name = val('Name') ?? ''
  const link = (label: string, v: string) =>
    label === 'Email' ? `<a href="mailto:${escapeHtml(v)}" style="color:#2563eb;text-decoration:none;">${escapeHtml(v)}</a>`
      : label === 'Phone' ? `<a href="tel:${escapeHtml(v.replace(/[^+\d]/g, ''))}" style="color:#2563eb;text-decoration:none;">${escapeHtml(v)}</a>`
        : escapeHtml(v)
  const facts = d.rows.filter(([k]) => !['Call', 'When', 'Name'].includes(k)).map(([k, v]) =>
    `<tr><td style="padding:7px 16px 7px 0;${LABEL}vertical-align:top;white-space:nowrap;">${escapeHtml(k)}</td>`
    + `<td style="padding:7px 0;font-size:15px;color:#18181b;word-break:break-word;">${link(k, v)}</td></tr>`).join('')
  const answers = d.answers
    ? d.answers.split(NL + NL).map(block => {
        const [q, ...a] = block.split(NL)
        return `<div style="margin:0 0 10px;padding:12px 14px;background:#ffffff;border:1px solid #e4e4e7;border-radius:10px;">`
          + `<p style="margin:0 0 4px;font-size:12px;line-height:1.4;color:#71717a;">${escapeHtml(q ?? '')}</p>`
          + `<p style="margin:0;font-size:15px;line-height:1.5;color:#18181b;word-break:break-word;">${a.map(escapeHtml).join('<br>')}</p></div>`
      }).join('')
    : `<p style="margin:0;font-size:14px;color:#71717a;">They answered no other questions.</p>`
  return `<p style="margin:0;font-size:22px;line-height:1.25;font-weight:700;color:#18181b;letter-spacing:-0.01em;">${escapeHtml(name)}</p>`
    + `<p style="margin:4px 0 16px;font-size:14px;color:#52525b;">${escapeHtml(val('Call') ?? 'A call')}</p>`
    + whenBox(val('When'))
    + `<table role="presentation" style="border-collapse:collapse;width:100%;margin:0 0 20px;">${facts}</table>`
    + `<p style="margin:0 0 10px;${LABEL}">Their answers</p>${answers}`
    + (d.calendar ? `<p style="margin:16px 0 0;font-size:12px;color:#71717a;">The attached invitation puts this call in your calendar.</p>` : '')
}

const LABEL = 'font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#71717a;'
const whenBox = (when: string | null, tint = '#eff6ff') => when
  ? `<div style="margin:0 0 18px;padding:12px 14px;background:${tint};border-radius:10px;"><p style="margin:0;${LABEL}">When</p>`
    + `<p style="margin:2px 0 0;font-size:17px;font-weight:600;color:#18181b;">${escapeHtml(when)} <span style="font-size:13px;font-weight:400;color:#52525b;">Melbourne time</span></p></div>`
  : ''

/** The bare email info@ gets: the call's name and its time — nothing about the person (calendly-core BOOKING_BLOCK_TO). */
export function bookingBlockHtml(call: string, when: string | null, cancelled = false): string {
  return `<p style="margin:0 0 16px;font-size:18px;font-weight:700;color:#18181b;">${escapeHtml(call)}</p>`
    + whenBox(when, cancelled ? '#fef2f2' : '#eff6ff')
    + `<p style="margin:0;font-size:13px;color:#71717a;">${cancelled
      ? 'This call was cancelled. The attached notice takes it off your calendar.'
      : 'The attached invitation blocks this time in your calendar.'}</p>`
}

/**
 * A BOOKING, TOLD TO THE THREE INBOXES (the owner, 12 Nov 2026):
 *   hello@ and contact@ — the person, how to reach them, and every answer (calendly-core BOOKING_DETAILS_TO), with an
 *     invitation that puts the call in their own calendar (name and number only — the answers stay in the email);
 *   info@ — the call's name and time only, with an invitation that blocks the time (BOOKING_BLOCK_TO).
 * A CANCELLED call sends each of them a withdrawal, so the entry comes off again.
 * One email per booking per address per kind: notify() claims a key built from the invitee id, so Calendly's retries
 * send nothing twice. Best-effort — a failed email never fails the webhook, or Calendly would retry the lead.
 */
export async function sendBookingDetails(b: Booking, leadUrl: string | null): Promise<void> {
  if (b.kind !== 'booked' && b.kind !== 'cancelled') return
  const cancelled = b.kind === 'cancelled'
  const when = b.startsAt ? callWords(b.startsAt) : null
  const slot = bookingSlot(b)
  const uids = bookingUids(b)
  const call = b.event ?? 'A call'
  const name = [b.fname, b.lname].filter(Boolean).join(' ') || b.email
  const d = cancelled ? null : bookingDetails(b, when)
  const from = noReplyAddress()
  const invite = (to: string, uid: string, title: string, note: string | null) => slot ? { attachments: [{
    filename: cancelled ? 'cancelled.ics' : 'call.ics', contentType: `text/calendar; method=${cancelled ? 'CANCEL' : 'REQUEST'}`,
    content: Buffer.from(bookingIcs({ method: cancelled ? 'CANCEL' : 'REQUEST', uid, title, startsAt: slot.startsAt, endsAt: slot.endsAt, note, organizerEmail: from, attendeeEmail: to })),
  }] } : {}
  const send = async (to: string, eventType: string, subject: string, bodyHtml: string, extra: object) => {
    try {
      await notify({ eventType, entityType: 'calendly_booking', entityId: inviteeId(b.inviteeUri), recipientEmail: to, subject, bodyHtml, replyTo: b.email, clientId: null, ...extra })
    } catch (e) {
      console.error('[calendly] could not email', eventType, 'to', to, e instanceof Error ? e.message : e)
    }
  }
  for (const to of BOOKING_DETAILS_TO) {
    if (cancelled) {
      await send(to, 'call_cancelled_details', `Call cancelled: ${name} (${call})`,
        renderEmail('A booked call was cancelled', `<p style="margin:0 0 16px;font-size:18px;font-weight:700;color:#18181b;">${escapeHtml(name)}</p>${bookingBlockHtml(call, when, true)}`, leadUrl ? 'Open the lead' : undefined, leadUrl ?? undefined),
        invite(to, uids.details, `${call}: ${name}`, null))
    } else if (d) {
      await send(to, 'call_booked_details', d.subject,
        renderEmail('A new call has been booked', bookingDetailsHtml(d), leadUrl ? 'Open the lead' : undefined, leadUrl ?? undefined),
        invite(to, uids.details, `${call}: ${name}`, d.calendar?.note ?? null))
    }
  }
  for (const to of BOOKING_BLOCK_TO) {
    await send(to, cancelled ? 'call_cancelled_block' : 'call_booked_block', cancelled ? `Call cancelled: ${call}` : `Call booked: ${call}`,
      renderEmail(cancelled ? 'A booked call was cancelled' : 'A call has been booked', bookingBlockHtml(call, when, cancelled)),
      invite(to, uids.block, call, null))
  }
}
