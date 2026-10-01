import { NextRequest, NextResponse } from 'next/server'
import { recordWebhook } from '@/app/lib/meta-ig'
import { handshakeChallenge, readMetaIgEnv, verifyWebhookSignature } from '@/app/lib/meta-ig-core'

/**
 * META'S WEBHOOK for directly connected Instagram accounts (1 Oct 2026,
 * branch meta-instagram-login). Callback URL:
 * https://app.mdmmarketing.com.au/api/meta/webhook
 *
 * PUBLIC and Clerk-free: Meta calls it. Absent from middleware.ts's protected
 * list and matcher, and must stay so.
 *
 * GET  — the subscription handshake: echoes hub.challenge only for
 *        hub.mode=subscribe with the right META_WEBHOOK_VERIFY_TOKEN.
 * POST — verifies X-Hub-Signature-256 over the RAW body with
 *        META_IG_APP_SECRET, records the delivery once, and STORES comments,
 *        mentions and messages. It replies to nobody, DMs nobody and emails
 *        nobody (the owner's rule: nothing ever replies to a prospect on its
 *        own). Zernio's webhook is separate and unchanged.
 */
export const dynamic = 'force-dynamic'

const plain = (body: string, status: number) =>
  new NextResponse(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } })

export async function GET(req: NextRequest) {
  const { verifyToken } = readMetaIgEnv()
  if (!verifyToken) return plain('Not configured: META_WEBHOOK_VERIFY_TOKEN is not set.', 503)
  const challenge = handshakeChallenge(req.nextUrl.searchParams, verifyToken)
  if (challenge == null) return plain('Forbidden', 403)
  return plain(challenge, 200)
}

export async function POST(req: NextRequest) {
  const { appSecret } = readMetaIgEnv()
  if (!appSecret) return plain('Not configured: META_IG_APP_SECRET is not set.', 503)

  const raw = await req.text()
  if (!verifyWebhookSignature(raw, req.headers.get('x-hub-signature-256'), appSecret)) {
    return plain('Bad signature', 401)
  }
  let body: unknown
  try { body = JSON.parse(raw) } catch { return plain('Body is not JSON', 400) }

  try {
    const result = await recordWebhook(raw, body, Date.now())
    return NextResponse.json(result.kind === 'duplicate' ? { ok: true, duplicate: true } : { ok: true, stored: result.stored })
  } catch {
    // a database failure: answer non-2xx so Meta delivers it again
    return plain('Could not record the delivery', 500)
  }
}
