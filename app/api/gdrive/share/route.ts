import { NextResponse } from 'next/server'
import { requireRole, authzErrorResponse } from '../../../lib/authz'
import { syncDriveMembers } from '../../../lib/gdrive-members'

/**
 * Re-share the folder tree with the team, by hand.
 *
 * The reconcile already runs on every team change and on connect, so this
 * button is for the times those did not stick: Drive was down, the app was
 * deployed after somebody joined, a permission was removed in Drive itself.
 * It is the same function, given nothing and computing everything, so pressing
 * it twice is as safe as pressing it once.
 *
 * super_admin, like connecting and disconnecting — one Drive connection serves
 * the whole agency, and who may open it is not an editor's decision.
 *
 * It is deliberately AWAITED rather than detached: a person pressed a button
 * and is owed the answer to "did that work", which is the one case where
 * making them wait on Google is the right trade.
 */
export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    await requireRole('super_admin')
    const result = await syncDriveMembers()
    if (!result.ok) {
      const said: Record<string, string> = {
        not_configured: 'Google Drive is not configured',
        not_connected: 'Connect Google Drive first',
        no_root_folder: 'The Drive folder could not be reached — try reconnecting',
        permissions_unreadable: 'Google would not say who the folder is shared with',
      }
      return NextResponse.json(
        { error: said[result.reason ?? ''] ?? 'Could not re-share the folder' },
        { status: 400 },
      )
    }
    return NextResponse.json(result)
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
