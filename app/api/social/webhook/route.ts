import { createHmac, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { registerFromZernioEvent } from '../../../lib/tracker'

/**
 * Provider webhooks: account lifecycle AND post events for the attribution
 * tracker (post.published / post.platform.published / post.external.*).
 *
 * Deliberately NOT behind Clerk: the caller is a machine. Two auth modes:
 * Zernio's documented X-Zernio-Signature (lowercase-hex HMAC-SHA256 of the
 * raw body, keyed by the webhook secret) is preferred; the legacy shared
 * secret comparison is kept so an already-configured webhook keeps working.
 */
export async function POST(req: Request) {
  const secret = process.env.ZERNIO_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Webhooks are not configured' }, { status: 503 })
  }

  // HMAC verification needs the RAW body — read it before any JSON parsing
  const raw = await req.text()

  const signature = req.headers.get('x-zernio-signature')
  const legacy =
    req.headers.get('x-webhook-secret') ??
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    new URL(req.url).searchParams.get('secret')

  const authed = signature ? hmacValid(raw, secret, signature) : legacy === secret
  if (!authed) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const event = String(body.event ?? body.type ?? '')
  const data = (body.payload ?? body.data ?? body) as Record<string, unknown>

  // ── post events → the Content Register ──
  if (event.startsWith('post.')) {
    // which client? the event's profile id maps through social_accounts —
    // best-effort: an unmapped post still registers, unassigned
    const profileId = String(data.profileId ?? data.profile_id ?? body.profileId ?? '')
    let clientId: string | null = null
    if (profileId) {
      const { data: client } = await supabase
        .from('clients').select('id').eq('social_profile_id', profileId).maybeSingle()
      clientId = (client?.id as string | undefined) ?? null
    }
    try {
      const asset = await registerFromZernioEvent(event, data, clientId)
      return NextResponse.json({ ok: true, registered: asset?.id ?? 'updated-or-known' })
    } catch (e) {
      console.error('webhook asset registration failed:', e)
      // 200 anyway — a registration bug must not make the provider disable
      // the webhook after 10 failures and silently stop ALL events
      return NextResponse.json({ ok: true, error: 'registration failed, logged' })
    }
  }

  // ── account lifecycle ──
  const accountId = String(data.accountId ?? data.account_id ?? data._id ?? '')
  if (!accountId) {
    console.warn('social webhook without an account id:', event)
    return NextResponse.json({ ok: true, ignored: 'no account id' })
  }

  if (event.includes('disconnect') || event.includes('revoked') || event.includes('expired')) {
    const { error } = await supabase
      .from('social_accounts')
      .update({ active: false })
      .eq('provider_account_id', accountId)
    if (error) {
      console.error('social webhook update failed:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true, marked: accountId })
  }

  return NextResponse.json({ ok: true, ignored: event })
}

function hmacValid(rawBody: string, secret: string, provided: string): boolean {
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(provided.trim().toLowerCase())
  return a.length === b.length && timingSafeEqual(a, b)
}
