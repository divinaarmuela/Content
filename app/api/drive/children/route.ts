import { NextResponse } from 'next/server'
import { authzErrorResponse } from '../../../lib/authz'
import { listEntries } from '../../../lib/gdrive-files'
import { FILES_BLOCK_WORDS, blockFor, requireFilesAccess } from '../../../lib/drive-page'
import { isDriveId } from '../../../lib/files-core'
import { PUBLIC_FOLDER_VIEW, folderUnreadableWords, parsePublicFolderView } from '../../../lib/drive-folder-files-core'
import { table } from '@/lib/db'

/**
 * The files in ONE Drive folder — the folder a card links to.
 *
 * Read only (trap 13): a listing, nothing else, so a card can draw the files
 * behind its Drive link as thumbnails (the owner, 15 Sep 2026: "display
 * files as their thumbnail and play it from there — the Drive link"). The
 * folder need not be inside HQ; a card's footage folder is wherever the
 * client or the shooter put it, and reading it changes nothing.
 *
 * TWO WAYS IN. The agency's connected account first: Drive's search, which
 * returns only what that account was shared on outright. Then, when that
 * comes back empty or cannot be asked, Google's public folder view — the
 * page a folder link shows a stranger — which lists an "anyone with the
 * link" folder the account was never shared on (the owner, 15 Sep 2026: the
 * card said "No files in the folder yet" over a footage folder holding
 * sixteen clips). When neither can see it, the words say what to do.
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
    if (result.ok && result.entries.length > 0) {
      return NextResponse.json({ entries: result.entries, more: result.nextPageToken !== null, source: 'account' })
    }

    // the public view: what the folder link shows anyone
    const seen = await publicFolderEntries(id)
    if (seen.length > 0) {
      return NextResponse.json({ entries: seen.slice(0, CHILDREN_PAGE), more: seen.length > CHILDREN_PAGE, source: 'public' })
    }

    if (!result.ok) {
      return NextResponse.json({ error: FILES_BLOCK_WORDS[blockFor(result.reason)] }, { status: 502 })
    }
    // the account sees nothing and the public view shows nothing: private to
    // somebody else, or truly empty — say what would make it show
    const account = await table<{ id: string; account_email?: string | null }>('drive_connection').get('team').catch(() => null)
    return NextResponse.json({ entries: [], more: false, source: 'account', note: folderUnreadableWords(account?.account_email ?? null) })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

async function publicFolderEntries(folderId: string) {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 8000)
    const res = await fetch(PUBLIC_FOLDER_VIEW(folderId), {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MD Media dashboard)' },
      signal: ctrl.signal,
      cache: 'no-store',
    })
    clearTimeout(timer)
    if (!res.ok) return []
    return parsePublicFolderView(await res.text())
  } catch {
    return []
  }
}
