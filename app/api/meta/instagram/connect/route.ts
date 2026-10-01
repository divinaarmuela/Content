import { NextRequest, NextResponse } from 'next/server'
import { requireRole, authzErrorResponse } from '@/app/lib/authz'
import { table } from '@/lib/db'
import { metaIgReady } from '@/app/lib/meta-ig'
import { authorizeUrl, signState } from '@/app/lib/meta-ig-core'

/**
 * GET /api/meta/instagram/connect?clientId= — start Instagram Business Login
 * for one client (1 Oct 2026, branch meta-instagram-login).
 *
 * Signed-in, account manager or super admin (the button is drawn for super
 * admins only; this is the real gate). Gated in middleware.ts and in its
 * matcher. Answers 503 with the reason until META_IG_APP_SECRET and
 * CREDENTIALS_KEY are set.
 *
 * The `state` is HMAC-signed with the app secret and carries the client, the
 * person and a 10-minute expiry — the callback is Clerk-free and trusts
 * nothing but that signature.
 */
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  let userId: string
  try {
    const me = await requireRole('account_manager')
    userId = me.id
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }

  const ready = metaIgReady()
  if (!ready.ok) return NextResponse.json({ error: ready.reason }, { status: 503 })

  const clientId = req.nextUrl.searchParams.get('clientId')?.trim()
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 })
  const client = await table('clients').get(clientId)
  if (!client) return NextResponse.json({ error: 'No such client' }, { status: 404 })

  const state = signState({ clientId, userId, now: Date.now() }, ready.env.appSecret)
  return NextResponse.redirect(authorizeUrl({ appId: ready.env.appId, redirectUri: ready.env.redirectUri, state }), 302)
}
