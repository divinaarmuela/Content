import { NextRequest, NextResponse } from 'next/server'
import { AuthzError, authzErrorResponse, requireRole } from '@/app/lib/authz'
import { table } from '@/lib/db'
import { mdAppReady } from '@/app/lib/md-app'
import { mdAppDialogUrl, signMdAppState } from '@/app/lib/md-app-core'
import { accessibleClientIds } from '@/app/lib/production-access'

/** the client must be one this person works on — the same rule as the Instagram / Facebook connects */
async function assertMine(user: Parameters<typeof accessibleClientIds>[0], clientId: string) {
  const ids = await accessibleClientIds(user)
  if (ids !== null && !ids.includes(clientId)) throw new AuthzError('That client is not one of yours', 403)
}

/**
 * GET /api/meta/md-app/connect?clientId= — start MD App's Unified Login (Facebook Login for Business,
 * config_id "Connect client accounts") for one client (6 Nov 2026). Account manager+, on a client of theirs.
 * 503 with a plain reason until MD_SECRET and CREDENTIALS_KEY are set. The state carries the MD App
 * prefix, so the shared callback (/api/meta/facebook/callback) hands it to the MD App handler.
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
  const ready = mdAppReady()
  if (!ready.ok) return NextResponse.json({ error: ready.reason }, { status: 503 })
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 })
  const client = await table('clients').get(clientId)
  if (!client) return NextResponse.json({ error: 'No such client' }, { status: 404 })
  const state = signMdAppState({ clientId, userId, now: Date.now() }, ready.env.appSecret)
  return NextResponse.redirect(mdAppDialogUrl({ appId: ready.env.appId, configId: ready.env.configId, redirectUri: ready.env.redirectUri, state }), 302)
}
