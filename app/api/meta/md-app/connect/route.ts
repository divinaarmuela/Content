import { NextRequest, NextResponse } from 'next/server'
import { AuthzError, authzErrorResponse, requireRole } from '@/app/lib/authz'
import { table } from '@/lib/db'
import { mdAppReady } from '@/app/lib/md-app'
import { mdAppDialogUrl, signMdAppState } from '@/app/lib/md-app-core'
import { accessibleClientIds } from '@/app/lib/production-access'
import { isReviewer } from '@/app/lib/reviewer-lock-core'

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
  let rv = false
  try {
    const me = await requireRole('account_manager')
    userId = me.id
    rv = isReviewer(me.clerk_user_id)
    // Meta's reviewer MAY press Connect with Meta's own test accounts (App Review guide: "We will test your app using our
    // own test accounts") — so the reviewer login is allowed to connect, on the test client only (assertMine). 9 Nov 2026.
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
  // ?kind=ads — the ads connect: the second configuration, a USER access token with ads_read / ads_management (9 Nov 2026)
  // ONE LOGIN (9 Nov 2026): when the user-token configuration is set, every connect uses it — Instagram, Pages and Ads in
  // one Facebook screen. ?kind=business keeps the old system-user configuration reachable for after App Review.
  const ads = req.nextUrl.searchParams.get('kind') !== 'business' && !!ready.env.adsConfigId
  if (ads && !ready.env.adsConfigId) return NextResponse.json({ error: 'The ads login is not set up yet (MD_APP_ADS_CONFIG_ID is missing).' }, { status: 503 })
  const state = signMdAppState({ clientId, userId, now: Date.now(), ...(ads ? { kind: 'ads' as const } : {}), rv }, ready.env.appSecret)
  return NextResponse.redirect(mdAppDialogUrl({ appId: ready.env.appId, configId: ads ? ready.env.adsConfigId! : ready.env.configId, redirectUri: ready.env.redirectUri, state }), 302)
}
