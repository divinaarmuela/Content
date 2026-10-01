import { NextRequest, NextResponse } from 'next/server'
import { guard } from '@/app/lib/authz'
import { metaIgReady, subscribeWebhooksFor } from '@/app/lib/meta-ig'

/**
 * POST /api/meta/instagram/subscribe { ig_user_id } — subscribe an already-connected account to this app's
 * webhooks (comments, messages). Connecting does it on its own since 1 Oct 2026; this is for an account
 * connected before that, or one whose subscription failed. Super admins only.
 */
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const denied = await guard('super_admin')
  if (denied) return denied
  const ready = metaIgReady()
  if (!ready.ok) return NextResponse.json({ error: ready.reason }, { status: 503 })
  const body = await req.json().catch(() => ({})) as { ig_user_id?: unknown }
  const id = String(body.ig_user_id ?? '').trim()
  if (!/^\d{5,30}$/.test(id)) return NextResponse.json({ error: 'ig_user_id is required' }, { status: 400 })
  try {
    const out = await subscribeWebhooksFor(id)
    return NextResponse.json({ ok: out.success })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'The subscription failed' }, { status: 502 })
  }
}
