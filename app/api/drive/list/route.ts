import { NextResponse } from 'next/server'
import { authzErrorResponse } from '../../../lib/authz'
import { listEntries, searchBelow } from '../../../lib/gdrive-files'
import {
  FILES_BLOCK_WORDS, blockFor, filesRoot, mirrorFactsFor, requireFilesAccess,
} from '../../../lib/drive-page'
import { modifiedSince, parseListRequest } from '../../../lib/files-core'

/**
 * One page of a folder — or a search of everything below it.
 *
 * Read-only, and the only route the page calls while somebody is browsing. It
 * is deliberately a THIN wrapper: the query string is read by
 * `parseListRequest`, the `q` is built by `driveQuery`, and both of those are
 * pure and tested. What is left here is the role gate and the shape of the
 * reply.
 *
 * ── Why a search is a walk ──
 *
 * Drive's `q` has no subtree operator. `'x' in parents` means x's DIRECT
 * children, so the old "search in this folder" quietly missed everything one
 * level down while the page said "in here or below it" — which is how somebody
 * concludes a file is gone and uploads it again, into the owner's real
 * archive. `searchBelow` walks, bounded, and says how far it got.
 *
 * The reply also carries `clients`: which of the returned files the app itself
 * mirrored, and for whom. That is the `drive_files` join, done once per
 * listing on the server, rather than the browser subscribing to the whole
 * table to answer the same question.
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
      return NextResponse.json({ error: FILES_BLOCK_WORDS.not_picked }, { status: 409 })
    }

    const parentId = request.parentId ?? root.id
    const common = {
      text: request.text,
      type: request.type,
      since: modifiedSince(request.modified, new Date()),
      ownerEmail: request.ownerEmail,
      foldersOnly: request.foldersOnly,
      sort: request.sort,
    }

    // a search looks below; a plain listing is one folder deep, paged
    const result = request.text && !request.foldersOnly
      ? await searchBelow({ ...common, parentId })
      : await listEntries({ ...common, parentId, pageToken: request.pageToken })

    if (!result.ok) {
      return NextResponse.json(
        { error: FILES_BLOCK_WORDS[blockFor(result.reason)] },
        { status: 502 },
      )
    }

    const facts = await mirrorFactsFor(result.entries.map(e => e.id))
    const clients: Record<string, string> = {}
    for (const [id, fact] of facts) if (fact.client_id) clients[id] = fact.client_id

    return NextResponse.json({
      entries: result.entries,
      next_page: 'nextPageToken' in result ? result.nextPageToken : null,
      parent: parentId,
      clients,
      searched: 'foldersSearched' in result ? result.foldersSearched : 1,
      capped: 'capped' in result ? result.capped : false,
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
