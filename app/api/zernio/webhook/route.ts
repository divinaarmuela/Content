import { handleZernioWebhook } from '@/app/lib/zernio-webhook'

/**
 * The provider-named alias of `/api/social/webhook`.
 *
 * Same handler, same authentication, same idempotency — this exists so that a
 * URL typed from Zernio's own dashboard ("your app's /api/zernio/webhook")
 * works rather than 404ing at 2am. Register ONE of the two; registering both
 * would deliver every event twice, which is harmless (the conditional update
 * makes the second a no-op) but pointless.
 *
 * Public by construction: `/api/zernio` is absent from the middleware matcher,
 * so Clerk never runs here. The signature is the authentication.
 */
export async function POST(req: Request) {
  return handleZernioWebhook(req)
}
