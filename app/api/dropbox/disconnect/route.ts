import { NextResponse } from 'next/server'
import { requireRole, authzErrorResponse } from '../../../lib/authz'
import { disconnectDropbox } from '../../../lib/dropbox'

/**
 * Forget the stored token. super_admin only, for the same reason connecting
 * is: this is one switch for the whole agency.
 *
 * The folders and the links already recorded on shoots and items are left
 * alone — they keep working for anyone who has Dropbox access directly, and a
 * reconnect picks up exactly where this left off.
 */
export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    await requireRole('super_admin')
    await disconnectDropbox()
    return NextResponse.json({ ok: true })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
