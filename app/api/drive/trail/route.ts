import { NextResponse } from 'next/server'
import { authzErrorResponse } from '../../../lib/authz'
import { trailTo } from '../../../lib/gdrive-files'
import { FILES_BLOCK_WORDS, blockFor, filesRoot, requireFilesAccess } from '../../../lib/drive-page'
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
      return NextResponse.json({ error: FILES_BLOCK_WORDS.not_picked }, { status: 409 })
    }
    const result = await trailTo(id, root.id)
    if (!result.ok) {
      return NextResponse.json(
        { error: FILES_BLOCK_WORDS[blockFor(result.reason)] }, { status: 502 },
      )
    }
    return NextResponse.json({ trail: result.trail })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
