import 'server-only'
import { createHash } from 'node:crypto'
import { table } from '@/lib/db'
import type { Lead } from '@/lib/db-types'
import { bookingPatch, signingKey, type Booking } from './calendly-core'
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
