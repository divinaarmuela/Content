import { NextResponse } from 'next/server'
import { handleStreamWebhook } from '@/app/lib/stream'

/**
 * Cloudflare Stream telling us an encode finished.
 *
 * Public by construction: `/api/stream` is absent from the middleware matcher
 * (middleware.ts), so Clerk never runs here — the same arrangement as
 * `/api/zernio/webhook` and `/api/inngest`. The `Webhook-Signature` header is
 * the authentication; see `handleStreamWebhook` for the verification and for
 * what happens when no secret is configured.
 *
 * This is the live path and it answers in seconds. The half-hourly sweep polls
 * anything still `processing` after two minutes, so a delivery that never
 * arrives costs a delay, not a broken video.
 *
 * The raw text of the body is what was signed, so it is read as text and
 * parsed downstream. Reading it with `req.json()` and re-serialising would
 * change key order and whitespace, and every genuine delivery would fail
 * verification.
 */
export async function POST(req: Request) {
  const raw = await req.text()
  const { status, body } = await handleStreamWebhook(raw, req.headers.get('webhook-signature'))
  return NextResponse.json(body, { status })
}
