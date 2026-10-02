import { NextResponse } from 'next/server'
import { withRequestCache } from '@/lib/db'
import { requireRole, authzErrorResponse, AuthzError } from '../../../../../lib/authz'
import { loadItemForUser } from '../../../../../lib/production-access'
import { splitCard } from '../../../../../lib/split'

/**
 * SPLIT (docs/COLOUR_GRADE_SPLIT_SPEC.md C6, the team's door): an account manager or a super admin splits a card with
 * the client — the videos the client approved go to handover, the rest become "<title> · Round N" for the editor.
 * The client's own door is "Send my answers" on their portal (app/api/portal/act, action send_answers).
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      if (!['account_manager', 'super_admin'].includes(user.role)) throw new AuthzError('Splitting a card is for account managers and super admins', 403)
      const { id } = await params
      await loadItemForUser(user, id)   // may this person see this card at all
      const result = await splitCard(user, id, { by: 'team' })
      return NextResponse.json(result)
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
