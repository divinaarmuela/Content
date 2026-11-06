import { NextRequest, NextResponse } from 'next/server'
import { authzErrorResponse, requireRole } from '@/app/lib/authz'
import { MdAppError, runTest } from '@/app/lib/md-app'
import { isMdTestId } from '@/app/lib/md-app-core'

/**
 * POST /api/meta/md-app/test { clientId, test } — ONE real Graph call for one permission, so Meta's App
 * Dashboard logs the successful call it wants before App Review (6 Nov 2026). Super admins only. Answers a
 * count or field names — never a token, never the raw payload.
 */
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try { await requireRole('super_admin') } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  const body = await req.json().catch(() => null) as { clientId?: unknown; test?: unknown } | null
  const clientId = typeof body?.clientId === 'string' ? body.clientId.trim() : ''
  const test = body?.test
  if (!clientId || !isMdTestId(test)) return NextResponse.json({ error: 'clientId and a known test are required' }, { status: 400 })
  try {
    return NextResponse.json(await runTest(clientId, test))
  } catch (e) {
    if (e instanceof MdAppError) {
      const status = e.status === 503 || e.status === 409 ? e.status : 502
      return NextResponse.json({ error: e.detail?.userMessage ?? e.message }, { status })
    }
    return NextResponse.json({ error: 'The test failed' }, { status: 500 })
  }
}
