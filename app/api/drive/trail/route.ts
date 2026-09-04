import { NextResponse } from 'next/server'
import { authzErrorResponse } from '../../../lib/authz'
import { trailTo } from '../../../lib/gdrive-files'
import { filesRoot, requireFilesAccess } from '../../../lib/drive-page'
import { isDriveId } from '../../../lib/files-core'

/**
 * The breadcrumb for a folder somebody arrived at sideways — from a search
 * result, or from a link a colleague sent.
 *
 * Browsing down builds its own path as it goes and never calls this. It exists
 * so that landing in the middle of the tree still tells a person where they
 * are, rather than showing one folder name and no way back up.
 */
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    await requireFilesAccess()
    const id = new URL(req.url).searchParams.get('id') ?? ''
    if (!isDriveId(id)) {
      return NextResponse.json({ error: 'That folder could not be found' }, { status: 400 })
    }
    const root = await filesRoot()
    if (!root) {
      return NextResponse.json(
        { error: 'Google Drive is not connected yet. An admin can connect it in Settings.' },
        { status: 400 },
      )
    }
    const result = await trailTo(id, root.id)
    if (!result.ok) return NextResponse.json({ error: result.message }, { status: 502 })
    return NextResponse.json({ trail: result.trail })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
