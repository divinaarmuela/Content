import { NextResponse } from 'next/server'
import { withRequestCache } from '@/lib/db'
import { AuthzError, authzErrorResponse, requireSignedIn, type TeamUser } from '../../lib/authz'
import { viewerOf, type Result } from '../../lib/creator-campaigns'
import type { Viewer } from '../../lib/creator-campaign-core'

/**
 * What every creator-campaign route does first and last: who is asking (a client login is never let in — the portal
 * is the client's surface), then the wrapper's answer turned into a response. No rule lives in a route.
 */
export function asTeam(run: (v: Viewer, user: TeamUser) => Promise<NextResponse>): Promise<NextResponse> {
  return withRequestCache(async () => {
    try {
      const user = await requireSignedIn()
      if (user.role === 'client') throw new AuthzError('Creator campaigns are the team’s page', 403)
      return await run(await viewerOf(user), user)
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}

export function answer<T>(res: Result<T>, key: string, okStatus = 200): NextResponse {
  if (res.ok) return NextResponse.json({ [key]: res.value }, { status: okStatus })
  return NextResponse.json({ error: res.reason, ...(res.fresh ? { fresh: res.fresh } : {}) }, { status: res.status })
}

export const bodyOf = async (req: Request): Promise<Record<string, unknown>> => {
  const b = await req.json().catch(() => ({}))
  return b && typeof b === 'object' ? (b as Record<string, unknown>) : {}
}

export const isManager = (v: Viewer) => v.role === 'super_admin' || v.role === 'account_manager'
