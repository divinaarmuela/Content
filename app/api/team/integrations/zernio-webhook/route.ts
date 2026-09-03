import { randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { ProviderWebhook } from '@/lib/db-types'
import { requireRole, authzErrorResponse, AuthzError } from '@/app/lib/authz'
import { encryptSecret, credentialsKeyConfigured } from '@/app/lib/secret-box'
import { registerZernioWebhook } from '@/app/lib/publisher'
import { ZERNIO_WEBHOOK_EVENTS } from '@/app/lib/zernio-webhook-core'
import { zernioWebhookUrl, forgetWebhookSecrets } from '@/app/lib/zernio-webhook'

export const dynamic = 'force-dynamic'

/**
 * "Enable instant post updates" — register our webhook with Zernio.
 *
 * Until this is pressed (or ZERNIO_WEBHOOK_SECRET is set by hand), the
 * dashboard only learns a post went live from the 10-minute reconcile poll, so
 * the board can say "Scheduled" about something already on Instagram.
 *
 * Super-admin only: this hands a shared secret to an external service on
 * behalf of the whole agency. Hiding the button would be presentation; this is
 * the enforcement.
 *
 * Safe to press twice — `registerZernioWebhook` updates the existing
 * registration for the same URL rather than adding a second one, and the row
 * here is found by (provider, url) and patched rather than added again.
 */
export async function POST() {
  return withRequestCache(async () => {
  try {
    const viewer = await requireRole('super_admin')

    if (!process.env.ZERNIO_API_KEY) {
      throw new AuthzError('The publishing service is not configured — set ZERNIO_API_KEY first', 400)
    }
    if (!credentialsKeyConfigured()) {
      throw new AuthzError(
        'CREDENTIALS_KEY is not set — refusing to store the webhook secret unencrypted', 400)
    }

    const url = zernioWebhookUrl()
    // 32 bytes of hex: ours, generated here, never round-tripped through the
    // browser. The provider echoes it back but is not the source of it.
    const secret = randomBytes(32).toString('hex')

    const hook = await registerZernioWebhook({
      url,
      secret,
      events: ZERNIO_WEBHOOK_EVENTS,
      name: 'MD Media dashboard',
    })

    const row = {
      provider: 'zernio',
      provider_hook_id: hook.id,
      url: hook.url,
      events: hook.events,
      secret_encrypted: encryptSecret(hook.secret),
      active: true,
      registered_by: viewer.email,
      updated_at: new Date().toISOString(),
    }
    try {
      // (provider, url) is the key the old upsert conflicted on; it is a pair,
      // so the match is made here
      const hooks = table<ProviderWebhook>('provider_webhooks')
      const existing = (await hooks.list({
        by: { provider: 'zernio' }, where: r => r.url === hook.url, limit: 1,
      }))[0]
      if (existing) await hooks.update(existing.id, row)
      else await table('provider_webhooks').insert(row)
    } catch (e) {
      // The registration itself succeeded, so say so rather than implying
      // nothing happened — but the secret is now only at the provider, and a
      // delivery we cannot verify is a delivery we will reject.
      return NextResponse.json({
        error: `Zernio accepted the webhook but the secret could not be saved (${(e as Error).message}). `
          + 'Press this again.',
      }, { status: 500 })
    }

    forgetWebhookSecrets()

    return NextResponse.json({
      ok: true,
      url: hook.url,
      events: hook.events,
      message: hook.created
        ? `Instant post updates enabled — Zernio will now deliver ${hook.events.length} `
          + `event types to ${hook.url}`
        : `Instant post updates were already on; the existing registration now covers `
          + `${hook.events.length} event types`,
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
