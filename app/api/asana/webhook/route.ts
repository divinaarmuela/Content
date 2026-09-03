import { NextResponse } from 'next/server'
import { table, DbError, withRequestCache } from '@/lib/db'
import type { AsanaWebhook } from '@/lib/db-types'
import { verifySignature, normalizeBatch, isHeartbeat } from '@/app/lib/asana-core'

/**
 * Asana webhook receiver — PUBLIC by design.
 *
 * Asana cannot carry a Clerk session, so this route is deliberately absent
 * from the middleware matcher (same posture as /api/submit). Its authenticity
 * check is the HMAC signature, not the session.
 *
 * Asana requires a success response within 10 seconds or it retries with
 * backoff for 24h and then deletes the webhook, so this does the minimum:
 * verify, insert, return. Hydration happens in the reconciler.
 */

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  return withRequestCache(async () => {
    const projectGid = new URL(req.url).searchParams.get('project')
    const hooks = table<AsanaWebhook>('asana_webhooks')

    // The raw body must be read as text and verified as-is. Parsing and
    // re-serialising can reorder keys, which breaks the HMAC for deliveries
    // that are perfectly valid.
    const rawBody = await req.text()

    // ── Handshake ──
    // On creation Asana POSTs an X-Hook-Secret. Echo it back verbatim; the
    // create call on the other side stays pending until we do.
    const handshakeSecret = req.headers.get('x-hook-secret')
    if (handshakeSecret) {
      if (!projectGid) {
        return NextResponse.json({ error: 'Missing project in target URL' }, { status: 400 })
      }
      try {
        const patch = {
          hook_secret: handshakeSecret,
          last_heartbeat_at: new Date().toISOString(),
          last_error: null,
        }
        const existing = await hooks.list({ by: { project_gid: projectGid }, limit: 1 })
        if (existing[0]) await hooks.update(existing[0].id, patch)
        // A row with no webhook_gid yet has no natural key to derive an id
        // from, so one is minted here.
        else await table('asana_webhooks').insert({ id: crypto.randomUUID(), project_gid: projectGid, ...patch })
      } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 500 })
      }

      return new NextResponse(null, {
        status: 200,
        headers: { 'X-Hook-Secret': handshakeSecret },
      })
    }

    // ── Delivery ──
    if (!projectGid) return NextResponse.json({ error: 'Missing project' }, { status: 400 })

    const hook = await hooks.list({ by: { project_gid: projectGid }, limit: 1 })
      .then(r => r[0] ?? null)

    if (!hook?.hook_secret) {
      // No secret stored means we cannot authenticate this caller at all.
      return NextResponse.json({ error: 'Unknown webhook' }, { status: 401 })
    }

    if (!verifySignature(rawBody, hook.hook_secret, req.headers.get('x-hook-signature'))) {
      return NextResponse.json({ error: 'Bad signature' }, { status: 401 })
    }

    let payload: { events?: unknown[] } = {}
    try { payload = JSON.parse(rawBody) } catch { /* treated as empty below */ }

    const now = new Date().toISOString()

    // Heartbeats arrive at handshake and roughly every 8h. They are the only
    // positive liveness signal we get, so they are recorded, not ignored — the
    // reconciler uses their absence to detect a self-deleted webhook.
    if (isHeartbeat(payload)) {
      await hooks.update(hook.id, { last_heartbeat_at: now })
      return new NextResponse(null, { status: 200 })
    }

    const rows = normalizeBatch((payload.events ?? []) as never[], {
      projectGid,
      source: 'webhook',
    })

    // The unique dedup_key absorbs the overlap with the reconciliation poll.
    // A collision is the system working, not an error.
    for (const row of rows) {
      try {
        await table('asana_events').insert(row)
      } catch (e) {
        if (!(e instanceof DbError && e.code === 'unique')) throw e
      }
    }

    await hooks.update(hook.id, { last_heartbeat_at: now, last_event_at: now })

    return new NextResponse(null, { status: 200 })
  })
}
