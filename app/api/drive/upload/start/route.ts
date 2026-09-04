import { NextResponse } from 'next/server'
import { authzErrorResponse } from '../../../../lib/authz'
import { openUploadSession } from '../../../../lib/gdrive-files'
import {
  clientForFolder, openUploadRow, requireFilesAccess,
} from '../../../../lib/drive-page'
import { MAX_UPLOAD_BYTES, UPLOAD_CHUNK, isDriveId } from '../../../../lib/files-core'

/**
 * Open a resumable upload for a file somebody dropped on a folder.
 *
 * The reply is an id of ours and a chunk size, and nothing else. The Google
 * session URI stays on the server in `drive_uploads`: handing it to the
 * browser would be handing out a capability that writes into the owner's Drive
 * without ever passing the role gate again.
 *
 * This route CREATES a file and adds nothing else — it cannot rename, move or
 * replace anything. A name that collides with something already in the folder
 * is Drive's business, and Drive keeps both; we do not rename either one.
 */
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const me = await requireFilesAccess()
    const body = await req.json().catch(() => ({})) as
      { parent?: string; name?: string; size?: unknown; mime_type?: string }

    if (!isDriveId(body.parent)) {
      return NextResponse.json({ error: 'That folder could not be found' }, { status: 400 })
    }
    const name = String(body.name ?? '').trim()
    if (!name) return NextResponse.json({ error: 'That file has no name' }, { status: 400 })

    const size = Number(body.size)
    if (!Number.isFinite(size) || size < 0) {
      return NextResponse.json({ error: 'That file could not be read' }, { status: 400 })
    }
    if (size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: 'That file is larger than Google Drive accepts' }, { status: 400 },
      )
    }

    const mimeType = String(body.mime_type ?? '').trim() || null
    const session = await openUploadSession(body.parent, name, size, mimeType ?? undefined)
    if (!session.ok) return NextResponse.json({ error: session.message }, { status: 502 })

    const row = await openUploadRow({
      uri: session.uri,
      name: session.name,
      parentId: body.parent,
      mimeType,
      size,
      clientId: await clientForFolder(body.parent),
      by: me.email ?? null,
    })

    return NextResponse.json({ upload: row.id, chunk_size: UPLOAD_CHUNK, name: session.name })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
