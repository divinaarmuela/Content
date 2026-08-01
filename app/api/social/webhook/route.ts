import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

/**
 * Provider webhooks — currently `account.disconnected`.
 *
 * Without this, a revoked or expired account is only discovered when a post
 * fails, which is after the fact and usually after somebody has noticed
 * nothing went out. This flips the account inactive the moment the provider
 * tells us, so the channels page shows it and the publish guard blocks it.
 *
 * Deliberately NOT behind Clerk: the caller is a machine. It authenticates
 * with a shared secret instead, and refuses everything if that secret is
 * unset — an unauthenticated endpoint that mutates account state would be
 * worse than not having the webhook at all.
 */
export async function POST(req: Request) {
  const secret = process.env.ZERNIO_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Webhooks are not configured' }, { status: 503 })
  }

  const provided =
    req.headers.get('x-webhook-secret') ??
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    new URL(req.url).searchParams.get('secret')

  if (provided !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const event = String(body.event ?? body.type ?? '')
  const data = (body.data ?? body) as Record<string, unknown>
  const accountId = String(data.accountId ?? data.account_id ?? data._id ?? '')

  if (!accountId) {
    // 200, not 4xx: an unrecognised payload should not make the provider
    // retry forever. Log it and move on.
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
