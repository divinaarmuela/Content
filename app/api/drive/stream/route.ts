import { authzErrorResponse } from '../../../lib/authz'
import { requireFilesAccess } from '../../../lib/drive-page'
import { isDriveId, isResourceKey } from '../../../lib/files-core'
import { streamDriveFile } from '../../../lib/drive-stream'

/**
 * A DRIVE CLIP, PLAYED HERE — the team's side (the owner, 15 Sep 2026: the
 * clip's review page). The gate is a signed-in team member with the Files
 * role; the bytes themselves come from lib/drive-stream, which the client's
 * portal route shares. Read only (trap 13): a GET of bytes, nothing more.
 */
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    await requireFilesAccess()
    const search = new URL(req.url).searchParams
    const id = search.get('id') ?? ''
    if (!isDriveId(id)) return new Response('Not found', { status: 404 })
    const range = req.headers.get('range')
    return await streamDriveFile(id, range, search.get('name'), isResourceKey(search.get('key')) ? search.get('key') : null)
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return new Response(error, { status })
  }
}
