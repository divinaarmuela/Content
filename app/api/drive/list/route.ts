import { NextResponse } from 'next/server'
import { authzErrorResponse } from '../../../lib/authz'
import { listEntries } from '../../../lib/gdrive-files'
import { filesRoot, requireFilesAccess } from '../../../lib/drive-page'
import { modifiedSince, parseListRequest } from '../../../lib/files-core'

/**
 * One page of a folder — or of a search across everything the app can see.
 *
 * Read-only, and the only route the page calls while somebody is browsing. It
 * is deliberately a THIN wrapper: the query string is read by
 * `parseListRequest`, the `q` is built by `driveQuery`, and both of those are
 * pure and tested. What is left here is the role gate and the shape of the
 * reply.
 *
 * A search with no `parent` walks the whole root, which under `drive.file` is
 * everything the app was given and nothing else — so "search everywhere" is
 * honest about its own edges without needing a special case.
 */
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    await requireFilesAccess()
    const url = new URL(req.url)
    const parsed = parseListRequest(k => url.searchParams.get(k))
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const request = parsed.request

    const root = await filesRoot()
    if (!root) {
      return NextResponse.json(
        { error: 'Google Drive is not connected yet. An admin can connect it in Settings.' },
        { status: 400 },
      )
    }

    // no parent and no search text means "the root", not "everything"
    const parentId = request.parentId ?? (request.text ? null : root.id)

    const result = await listEntries({
      parentId,
      text: request.text,
      type: request.type,
      since: modifiedSince(request.modified, new Date()),
      ownerEmail: request.ownerEmail,
      foldersOnly: request.foldersOnly,
      sort: request.sort,
      pageToken: request.pageToken,
    })
    if (!result.ok) return NextResponse.json({ error: result.message }, { status: 502 })

    return NextResponse.json({
      entries: result.entries,
      next_page: result.nextPageToken,
      parent: parentId,
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
