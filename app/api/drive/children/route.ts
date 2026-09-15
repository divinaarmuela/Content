import { NextResponse } from 'next/server'
import { authzErrorResponse } from '../../../lib/authz'
import { listEntries } from '../../../lib/gdrive-files'
import { FILES_BLOCK_WORDS, blockFor, requireFilesAccess } from '../../../lib/drive-page'
import { isDriveId } from '../../../lib/files-core'

/**
 * The files in ONE Drive folder — the folder a card links to.
 *
 * Read only (trap 13): a listing, nothing else, so a card can draw the files
 * behind its Drive link as thumbnails (the owner, 15 Sep 2026: "display
 * files as their thumbnail and play it from there — the Drive link"). The
 * folder need not be inside HQ; a card's footage folder is wherever the
 * client or the shooter put it, and reading it changes nothing. Whether the
 * connected Drive account can see it is Drive's answer, passed on in words.
 *
 * One page, name order — a footage folder with four thousand clips is not
 * four thousand tiles in a card.
 */
export const dynamic = 'force-dynamic'

export const CHILDREN_PAGE = 60

export async function GET(req: Request) {
  try {
    await requireFilesAccess()
    const id = new URL(req.url).searchParams.get('id') ?? ''
    if (!isDriveId(id)) return NextResponse.json({ error: 'Not a Drive folder' }, { status: 400 })

    const result = await listEntries({ parentId: id, pageSize: CHILDREN_PAGE, sort: { by: 'name', dir: 'asc' } })
    if (!result.ok) {
      return NextResponse.json({ error: FILES_BLOCK_WORDS[blockFor(result.reason)] }, { status: 502 })
    }
    return NextResponse.json({ entries: result.entries, more: result.nextPageToken !== null })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
