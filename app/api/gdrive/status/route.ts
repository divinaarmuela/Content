import { NextResponse } from 'next/server'
import { requireRole, authzErrorResponse } from '../../../lib/authz'
import { driveStatus } from '../../../lib/gdrive'

/**
 * Is Drive connected, and to whose account? Any team member may ask — the
 * answer is what an editor needs to know when a folder link is missing. No
 * token, and no folder beyond the root, ever appears in the reply.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await requireRole('scheduler')
    return NextResponse.json(await driveStatus())
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
