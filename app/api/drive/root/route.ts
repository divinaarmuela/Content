import { NextResponse } from 'next/server'
import { authzErrorResponse } from '../../../lib/authz'
import { driveConfigured } from '../../../lib/gdrive'
import { filesRoot, requireFilesAccess } from '../../../lib/drive-page'
import { PARTIAL_VIEW_NOTE } from '../../../lib/files-core'

/**
 * Where the Files page starts, and what it cannot see.
 *
 * `partial` is always true and says so out loud. The app holds Google's
 * `drive.file` scope: it sees folders it created and folders a person handed
 * it through the chooser, and nothing else. A page that quietly showed a
 * subset of somebody's Drive as if it were all of it would be worse than one
 * that says which subset.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await requireFilesAccess()
    if (!driveConfigured()) {
      return NextResponse.json({ connected: false, root: null, note: PARTIAL_VIEW_NOTE })
    }
    const root = await filesRoot()
    return NextResponse.json({
      connected: !!root,
      root,
      partial: true,
      note: PARTIAL_VIEW_NOTE,
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
