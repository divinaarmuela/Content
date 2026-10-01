import { NextRequest, NextResponse } from 'next/server'
import { guard } from '@/app/lib/authz'
import { listClientAccounts, metaIgReady } from '@/app/lib/meta-ig'

/**
 * GET /api/meta/instagram/accounts?clientId= — this client's DIRECT Instagram
 * connections, for the "Direct — testing" card. Super admins only. Never the
 * token: listClientAccounts strips it.
 */
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const denied = await guard('super_admin')
  if (denied) return denied
  const clientId = req.nextUrl.searchParams.get('clientId')?.trim()
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 })
  const ready = metaIgReady()
  const accounts = await listClientAccounts(clientId)
  return NextResponse.json({ configured: ready.ok, reason: ready.ok ? null : ready.reason, accounts })
}
