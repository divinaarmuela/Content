import { randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
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
 * here is upserted on (provider, url).
 */
export async function POST() {
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

    const { error } = await supabase.from('provider_webhooks').upsert({
      provider: 'zernio',
      provider_hook_id: hook.id,
      url: hook.url,
      events: hook.events,
      secret_encrypted: encryptSecret(hook.secret),
      active: true,
      registered_by: viewer.email,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'provider,url' })

    if (error) {
      // The registration itself succeeded, so say so rather than implying
      // nothing happened — but the secret is now only at the provider, and a
      // delivery we cannot verify is a delivery we will reject.
      return NextResponse.json({
        error: `Zernio accepted the webhook but the secret could not be saved (${error.message}). `
          + 'Run supabase/zernio_webhook.sql, then press this again.',
      }, { status: 500 })
    }

    forgetWebhookSecrets()

    return NextResponse.json({
      ok: true,
      url: hook.url,
      events: hook.events,
      message: hook.created
        ? `Instant post updates enabled — Zernio will now deliver to ${hook.url}`
        : 'Instant post updates were already on; the registration was refreshed',
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
