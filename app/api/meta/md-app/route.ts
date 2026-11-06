import { NextRequest, NextResponse } from 'next/server'
import { AuthzError, authzErrorResponse, requireRole } from '@/app/lib/authz'
import { MdAppError, disconnect, mdAppReady, refreshAssets, setPicked, setUseMdApp, statusFor } from '@/app/lib/md-app'
import { ASSET_KINDS, MD_TESTS, isGraphAssetId, type AssetKind } from '@/app/lib/md-app-core'
import { accessibleClientIds } from '@/app/lib/production-access'

async function assertMine(user: Parameters<typeof accessibleClientIds>[0], clientId: string) {
  const ids = await accessibleClientIds(user)
  if (ids !== null && !ids.includes(clientId)) throw new AuthzError('That client is not one of yours', 403)
}

/**
 * /api/meta/md-app (6 Nov 2026) — MD App, the separate opt-in road (docs/MD_APP_SETUP.md).
 * GET ?clientId=  the connection (never a token), assigned accounts, the switch, the test list. Account manager+ on their client.
 * POST (super admins only):
 *   { clientId, action: 'pick' | 'unpick', kind, assetId }
 *   { clientId, action: 'use', on }          THE switch "Use MD App for this client"
 *   { clientId, action: 'refresh' }          re-read what the client assigned
 *   { clientId, action: 'disconnect' }
 */
export const dynamic = 'force-dynamic'

const fail = (e: unknown) => {
  if (e instanceof MdAppError) {
    const status = e.status === 503 || e.status === 409 ? e.status : 502
    return NextResponse.json({ error: e.detail?.userMessage ?? e.message }, { status })
  }
  const { error, status } = authzErrorResponse(e)
  return NextResponse.json({ error }, { status })
}

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get('clientId')?.trim()
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 })
  try {
    const me = await requireRole('account_manager')
    await assertMine(me, clientId)
  } catch (e) { return fail(e) }
  const ready = mdAppReady()
  const s = await statusFor(clientId)
  return NextResponse.json({
    configured: ready.ok, reason: ready.ok ? null : ready.reason, ...s,
    tests: Object.entries(MD_TESTS).map(([id, t]) => ({ id, label: t.label, permissions: t.permissions })),
  })
}

export async function POST(req: NextRequest) {
  try { await requireRole('super_admin') } catch (e) { return fail(e) }
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const clientId = typeof body?.clientId === 'string' ? body.clientId.trim() : ''
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 })
  try {
    switch (body?.action) {
      case 'pick': case 'unpick': {
        const kind = body.kind as AssetKind
        if (!ASSET_KINDS.includes(kind) || !isGraphAssetId(body.assetId)) return NextResponse.json({ error: 'kind and assetId are required' }, { status: 400 })
        const ok = await setPicked(clientId, kind, body.assetId, body.action === 'pick')
        return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'That account is not one assigned to this client' }, { status: 404 })
      }
      case 'use': {
        if (typeof body.on !== 'boolean') return NextResponse.json({ error: 'on (true or false) is required' }, { status: 400 })
        const ok = await setUseMdApp(clientId, body.on)
        return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Connect this client to MD App first' }, { status: 409 })
      }
      case 'refresh': return NextResponse.json({ ok: true, ...(await refreshAssets(clientId, Date.now())) })
      case 'disconnect': {
        const ok = await disconnect(clientId)
        return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Not connected' }, { status: 404 })
      }
      default: return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (e) { return fail(e) }
}
