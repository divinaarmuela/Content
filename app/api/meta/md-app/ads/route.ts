import { NextRequest, NextResponse } from 'next/server'
import { AuthzError, authzErrorResponse, requireRole } from '@/app/lib/authz'
import { MdAppError, mdAppReady } from '@/app/lib/md-app'
import { adsResults, adsStatus, createTestCampaign, deleteTestCampaign, disconnectAds, pickAccount } from '@/app/lib/md-app-ads'
import { accessibleClientIds } from '@/app/lib/production-access'

async function assertMine(user: Parameters<typeof accessibleClientIds>[0], clientId: string) {
  const ids = await accessibleClientIds(user)
  if (ids !== null && !ids.includes(clientId)) throw new AuthzError('That client is not one of yours', 403)
}

/**
 * /api/meta/md-app/ads (9 Nov 2026) — the Ads section of the Meta card (app/lib/md-app-ads*.ts).
 * GET ?clientId=            the ads connection (never a token), the ad accounts this login sees, whether set up
 * GET ?clientId=&month=     the month's results per campaign + every campaign (READ ONLY)
 * POST { clientId, action }:
 *   'account' { accountId }  which ad account this client's Ads section reads
 *   'create'                 ONE paused test campaign, no budget — recorded so only it can be deleted
 *   'delete'  { campaignId } only a test campaign this app made
 *   'disconnect'             super admin only
 * Account manager+ on their client (Meta's reviewer signs in as one).
 */
export const dynamic = 'force-dynamic'

const fail = (e: unknown) => {
  if (e instanceof MdAppError) {
    const status = e.status && [400, 403, 409, 503].includes(e.status) ? e.status : 502
    return NextResponse.json({ error: e.message }, { status })
  }
  const { error, status } = authzErrorResponse(e)
  return NextResponse.json({ error }, { status })
}

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get('clientId')?.trim()
  const month = req.nextUrl.searchParams.get('month')?.trim()
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 })
  try { const me = await requireRole('account_manager'); await assertMine(me, clientId) } catch (e) { return fail(e) }
  try {
    if (month) return NextResponse.json(await adsResults(clientId, month))
    const ready = mdAppReady()
    return NextResponse.json({ ready: ready.ok && !!ready.env.adsConfigId, ...(await adsStatus(clientId)) })
  } catch (e) { return fail(e) }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const clientId = typeof body?.clientId === 'string' ? body.clientId.trim() : ''
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 })
  try {
    if (body?.action === 'disconnect') await requireRole('super_admin')
    else { const me = await requireRole('account_manager'); await assertMine(me, clientId) }
  } catch (e) { return fail(e) }
  try {
    switch (body?.action) {
      case 'account': await pickAccount(clientId, String(body.accountId ?? '')); return NextResponse.json({ ok: true })
      case 'create': return NextResponse.json({ ok: true, ...(await createTestCampaign(clientId)) })
      case 'delete': await deleteTestCampaign(clientId, String(body.campaignId ?? '')); return NextResponse.json({ ok: true })
      case 'disconnect': return (await disconnectAds(clientId)) ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Not connected' }, { status: 404 })
      default: return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (e) { return fail(e) }
}
