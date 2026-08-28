import { NextResponse } from 'next/server'
import { requireSignedIn, authzErrorResponse } from '../../../../../lib/authz'
import { loadItemForUser } from '../../../../../lib/production-access'
import { actOnPostingApproval } from '../../../../../lib/posting-approval'

/**
 * Final-post approval: {action:'send'|'approve'|'request_changes', note?,
 * client_too?}.
 *
 * The hat checks live in actOnPostingApproval (the E2E calls it directly, so
 * this stays thin): whoever holds the scheduling — or the owner, or a super
 * admin — sends; the client's account manager or a super admin approves. A
 * signed-in CLIENT may also answer here (the logged-in portal calls this
 * route): the client hat may approve, never send, and loadItemForUser scopes
 * them to their own client's items. The share-link portal reaches the same
 * function through /api/portal/act instead.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSignedIn()
    const { id } = await params
    const item = await loadItemForUser(user, id)
    const body = await req.json().catch(() => ({}))
    const action = String(body.action ?? '')
    if (!['send', 'approve', 'request_changes'].includes(action)) {
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
    const updated = await actOnPostingApproval(user, item, {
      action: action as 'send' | 'approve' | 'request_changes',
      note: typeof body.note === 'string' ? body.note : undefined,
      client_too: typeof body.client_too === 'boolean' ? body.client_too : undefined,
    })
    return NextResponse.json({
      ok: true,
      posting_approval_state: updated.posting_approval_state ?? null,
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
