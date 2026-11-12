import { NextResponse } from 'next/server'
import { parseBooking, verifySignature } from '@/app/lib/calendly-core'
import { applyBooking, calendlyKey, sendBookingDetails } from '@/app/lib/calendly'

/**
 * PUBLIC — Calendly calls this on every booking and cancellation (9 Nov 2026). Not in middleware's matcher on
 * purpose (Clerk-free, like /api/submit); the signature check is the lock. 401 for an unsigned body, 200 for
 * events we do not use so Calendly does not retry them.
 */
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const raw = await req.text()
  const key = calendlyKey()
  if (!key) return NextResponse.json({ error: 'not configured' }, { status: 503 })
  if (!verifySignature(req.headers.get('calendly-webhook-signature'), raw, key, Date.now())) {
    return NextResponse.json({ error: 'bad signature' }, { status: 401 })
  }
  let json: unknown
  try { json = JSON.parse(raw) } catch { return NextResponse.json({ error: 'bad body' }, { status: 400 }) }
  const booking = parseBooking(json)
  if (!booking) return NextResponse.json({ ok: true, ignored: true })
  const res = await applyBooking(booking)
  // hello@ and contact@ get the details and answers, info@ only the time block; a cancellation takes each entry off
  // again — best-effort, after the lead is safe
  if (booking.kind === 'booked' || booking.kind === 'cancelled') await sendBookingDetails(booking, res.id ? `${new URL(req.url).origin}/dashboard/leads/${res.id}` : null).catch(e => console.error('[calendly] booking details email failed', e))
  return NextResponse.json({ ok: true, ...res })
}
