import { NextResponse } from 'next/server'
import { withRequestCache } from '@/lib/db'
import { requireRole, authzErrorResponse } from '../../../../lib/authz'
import { assertClientAccess } from '../../../../lib/social-schedule'
import { clientManagers } from '../../../../lib/posting-approval'

/**
 * GET ?clientId= → who a scheduler can send a post to for approval.
 *
 * "Make sure they ask for approval to AM or whoever they tag." The list is
 * the client's account managers and the super admins — the people who may
 * actually say yes (`mayApprovePost`) — so the picker never offers a name
 * the server would refuse. Open to the scheduling floor, because the person
 * asking is exactly who needs it; the manager-gated /api/team is not.
 */
export async function GET(req: Request) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const clientId = new URL(req.url).searchParams.get('clientId') ?? ''
      if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 })
      await assertClientAccess(user, clientId)
      const people = await clientManagers(clientId)
      return NextResponse.json({
        people: people.map(p => ({ id: p.id, name: p.name || p.email })),
      })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
