import { NextRequest, NextResponse } from 'next/server'
import { AuthzError, authzErrorResponse, requireRole } from '@/app/lib/authz'
import { table } from '@/lib/db'
import { metaFbReady } from '@/app/lib/meta-fb'
import { fbLoginUrl, signFbState } from '@/app/lib/meta-fb-core'
import { accessibleClientIds } from '@/app/lib/production-access'

/** the client must be one this person works on — the same rule as the Instagram connect */
async function assertMine(user: Parameters<typeof accessibleClientIds>[0], clientId: string) {
  const ids = await accessibleClientIds(user)
  if (ids !== null && !ids.includes(clientId)) throw new AuthzError('That client is not one of yours', 403)
}

/**
 * GET /api/meta/facebook/connect?clientId= — start Facebook Login for Business ("Connect Facebook Page",
 * config_id) for one client (6 Nov 2026). Account manager or super admin, on a client of theirs; gated in
 * middleware.ts and its matcher. 503 with the reason until META_APP_SECRET and CREDENTIALS_KEY are set.
 * The `state` is HMAC-signed (client, person, 10-minute expiry) — the callback trusts nothing else.
 */
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get('clientId')?.trim()
  let userId: string
  try {
    const me = await requireRole('account_manager')
    userId = me.id
    if (clientId) await assertMine(me, clientId)
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  const ready = metaFbReady()
  if (!ready.ok) return NextResponse.json({ error: ready.reason }, { status: 503 })
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 })
  const client = await table('clients').get(clientId)
  if (!client) return NextResponse.json({ error: 'No such client' }, { status: 404 })
  const state = signFbState({ clientId, userId, now: Date.now() }, ready.env.appSecret)
  return NextResponse.redirect(fbLoginUrl({ appId: ready.env.appId, redirectUri: ready.env.redirectUri, configId: ready.env.configId, state }), 302)
}
