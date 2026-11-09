import { NextRequest, NextResponse } from 'next/server'
import { AuthzError, authzErrorResponse, requireRole } from '@/app/lib/authz'
import { MdAppError } from '@/app/lib/md-app'
import { insightsFor } from '@/app/lib/md-app-insights'
import { accessibleClientIds } from '@/app/lib/production-access'

/** GET /api/meta/md-app/insights?clientId= (9 Nov 2026) — the Meta card's Insights tab. Read only. Account manager+ on THEIR client. */
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get('clientId')?.trim()
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 })
  try {
    const me = await requireRole('account_manager')
    const ids = await accessibleClientIds(me)
    if (ids !== null && !ids.includes(clientId)) throw new AuthzError('That client is not one of yours', 403)
    return NextResponse.json(await insightsFor(clientId))
  } catch (e) {
    if (e instanceof MdAppError) return NextResponse.json({ error: e.message }, { status: e.status === 409 ? 409 : 502 })
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
