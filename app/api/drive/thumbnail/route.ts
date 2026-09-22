import { authzErrorResponse } from '../../../lib/authz'
import { openThumbnail } from '../../../lib/gdrive-files'
import { requireFilesAccess } from '../../../lib/drive-page'
import { isDriveId, isResourceKey } from '../../../lib/files-core'
import { PUBLIC_THUMBNAIL } from '../../../lib/drive-public-file-core'

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
 *
 * A FILE SHARED BY LINK (22 Sep 2026): our account is refused by id (see
 * info/route.ts), so the picture comes from Google's public thumbnail address
 * — the one the file's own link page draws — passed on the same way. A
 * stranger's answer that is not a picture (Google's sign-in page) is a 404.
 */
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    await requireFilesAccess()
    const url = new URL(req.url)
    const id = url.searchParams.get('id') ?? ''
    if (!isDriveId(id)) return new Response('Not found', { status: 404 })
    const size = Number(url.searchParams.get('size') ?? '400')

    const key = url.searchParams.get('key')
    const want = Number.isFinite(size) ? size : 400
    const result = await openThumbnail(id, want, isResourceKey(key) ? key : null)
    if (result.ok) {
      return new Response(result.body as unknown as BodyInit, {
        headers: { 'Content-Type': result.contentType, 'Cache-Control': 'private, max-age=3600' },
      })
    }

    // as anyone with the link
    const pub = await fetch(PUBLIC_THUMBNAIL(id, want), { cache: 'no-store' }).catch(() => null)
    const type = pub?.headers.get('content-type') ?? ''
    if (!pub || !pub.ok || !pub.body || !type.startsWith('image/')) {
      if (pub) void pub.body?.cancel().catch(() => undefined)
      return new Response('No preview', { status: 404 })
    }
    return new Response(pub.body as unknown as BodyInit, {
      headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=3600' },
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return new Response(error, { status })
  }
}
