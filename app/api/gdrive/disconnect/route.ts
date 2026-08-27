import { NextResponse } from 'next/server'
import { requireRole, authzErrorResponse } from '../../../lib/authz'
import { disconnectDrive } from '../../../lib/gdrive'

/**
 * Forget the stored token. super_admin only, for the same reason connecting
 * is: this is one switch for the whole agency.
 *
 * The folders and the links already recorded on shoots and items are left
 * alone — they keep working for anyone who has Drive access directly, and a
 * reconnect picks up exactly where this left off (the root folder id survives,
 * so the tree is rejoined rather than rebuilt).
 */
export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    await requireRole('super_admin')
    await disconnectDrive()
    return NextResponse.json({ ok: true })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
