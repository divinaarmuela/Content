import { NextRequest, NextResponse } from 'next/server'
import { requireRole, authzErrorResponse } from '../../../lib/authz'
import { cancelShootProposal } from '../../../lib/shoots'

export const dynamic = 'force-dynamic'

/** Cancel a proposal — the token page stops accepting answers. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    // same floor as creating one: the team edits the shoot it is running
    await requireRole('scheduler')
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    if (!body.cancel) return NextResponse.json({ error: 'Nothing to do' }, { status: 400 })
    await cancelShootProposal(id)
    return NextResponse.json({ success: true })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
