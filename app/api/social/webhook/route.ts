import { handleZernioWebhook } from '@/app/lib/zernio-webhook'

/**
 * Provider webhooks — post published/failed, and account disconnected.
 *
 * This is the URL registered with Zernio (it predates the post events, which
 * were added on top rather than given a second endpoint — one registration,
 * one delivery log, one place to look when something does not arrive).
 * `/api/zernio/webhook` is the same handler under the name the provider's
 * dashboard suggests; both work, only one needs registering.
 *
 * Deliberately NOT behind Clerk: the caller is a machine. It authenticates
 * with an HMAC-SHA256 signature over the raw body, falling back to a shared
 * secret, and refuses everything if no secret is configured — an
 * unauthenticated endpoint that marks posts published would be worse than not
 * having the webhook at all.
 */
export async function POST(req: Request) {
  return handleZernioWebhook(req)
}
