import { authzErrorResponse } from '../../../lib/authz'
import { openThumbnail } from '../../../lib/gdrive-files'
import { requireFilesAccess } from '../../../lib/drive-page'
import { isDriveId } from '../../../lib/files-core'

/**
 * A file's picture, fetched with our credentials and passed on as pixels.
 *
 * Drive's `thumbnailLink` is signed for the account that asked for it, so it
 * cannot go in an `<img src>` — either it fails, or it works by handing the
 * browser a credential-bearing URL. This route is the answer: same origin, no
 * token anywhere near the page, and the role gate applies to a preview exactly
 * as it applies to the file.
 *
 * Cached privately for an hour. A thumbnail is stable, the URL carries the
 * file id, and `private` keeps it in one person's browser rather than in a
 * shared cache that has not been asked who is looking.
 */
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    await requireFilesAccess()
    const url = new URL(req.url)
    const id = url.searchParams.get('id') ?? ''
    if (!isDriveId(id)) return new Response('Not found', { status: 404 })
    const size = Number(url.searchParams.get('size') ?? '400')

    const result = await openThumbnail(id, Number.isFinite(size) ? size : 400)
    if (!result.ok) return new Response('No preview', { status: 404 })

    return new Response(result.body as unknown as BodyInit, {
      headers: {
        'Content-Type': result.contentType,
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return new Response(error, { status })
  }
}
