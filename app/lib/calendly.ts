import 'server-only'
import { table, encodeKey } from '@/lib/db'
import type { Lead } from '@/lib/db-types'
import { bookingPatch, signingKey, type Booking } from './calendly-core'

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
    body: JSON.stringify({ url, events: ['invitee.created', 'invitee.canceled'], organization: me.current_organization, user: me.uri, scope: 'user', signing_key: key }),
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
  const byEmail = byUri.length ? [] : await leads.list({ where: l => (l.email ?? '').toLowerCase() === b.email, orderBy: [['created_at', 'desc']], fresh: true })
  const found = byUri[0] ?? byEmail[0]
  if (found) {
    await leads.update(found.id, bookingPatch(b, found, now.toISOString()) as Partial<Lead>)
    return { id: found.id, created: false }
  }
  const id = `cal_${encodeKey(b.email)}`
  const res = await leads.claim(id, current => {
    const base = current ?? ({ id, created_at: now.toISOString(), email: b.email } as Lead)
    return { ...base, ...bookingPatch(b, current, now.toISOString()) } as Lead
  })
  return { id, created: res.claimed && !byEmail.length }
}
