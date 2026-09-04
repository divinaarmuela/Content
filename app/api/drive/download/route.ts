import { authzErrorResponse } from '../../../lib/authz'
import { openDownload } from '../../../lib/gdrive-files'
import { requireFilesAccess } from '../../../lib/drive-page'
import { isDriveId } from '../../../lib/files-core'

/**
 * Download a file through the app rather than through Google.
 *
 * The same reason as the thumbnail: the bytes need our token, and the person
 * pressing the button has a session with us and not necessarily with the tech
 * account. Streamed straight through — a 2 GB master is never held in the
 * function's memory, it is a pipe from Google to the browser with an
 * authorisation check at the front.
 */
export const dynamic = 'force-dynamic'

/** A filename safe to put in a header: quotes and control characters out,
 *  and the real name repeated as UTF-8 for browsers that read it. */
function disposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

export async function GET(req: Request) {
  try {
    await requireFilesAccess()
    const id = new URL(req.url).searchParams.get('id') ?? ''
    if (!isDriveId(id)) return new Response('Not found', { status: 404 })

    const result = await openDownload(id)
    if (!result.ok) return new Response(result.message, { status: 404 })

    return new Response(result.body as unknown as BodyInit, {
      headers: {
        'Content-Type': result.contentType,
        'Content-Disposition': disposition(result.name),
        ...(result.size ? { 'Content-Length': result.size } : {}),
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return new Response(error, { status })
  }
}
