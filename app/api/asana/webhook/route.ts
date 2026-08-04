import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
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
  const projectGid = new URL(req.url).searchParams.get('project')

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
    const { error } = await supabase
      .from('asana_webhooks')
      .upsert(
        {
          project_gid: projectGid,
          hook_secret: handshakeSecret,
          last_heartbeat_at: new Date().toISOString(),
          last_error: null,
        },
        { onConflict: 'project_gid' }
      )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return new NextResponse(null, {
      status: 200,
      headers: { 'X-Hook-Secret': handshakeSecret },
    })
  }

  // ── Delivery ──
  if (!projectGid) return NextResponse.json({ error: 'Missing project' }, { status: 400 })

  const { data: hook } = await supabase
    .from('asana_webhooks')
    .select('hook_secret')
    .eq('project_gid', projectGid)
    .maybeSingle()

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
    await supabase
      .from('asana_webhooks')
      .update({ last_heartbeat_at: now })
      .eq('project_gid', projectGid)
    return new NextResponse(null, { status: 200 })
  }

  const rows = normalizeBatch((payload.events ?? []) as never[], {
    projectGid,
    source: 'webhook',
  })

  if (rows.length > 0) {
    // ignoreDuplicates: the unique dedup_key absorbs the overlap with the
    // reconciliation poll. A collision is the system working, not an error.
    await supabase.from('asana_events').upsert(rows, {
      onConflict: 'dedup_key',
      ignoreDuplicates: true,
    })
  }

  await supabase
    .from('asana_webhooks')
    .update({ last_heartbeat_at: now, last_event_at: now })
    .eq('project_gid', projectGid)

  return new NextResponse(null, { status: 200 })
}
