import { NextResponse } from 'next/server'
import { authzErrorResponse } from '../../../../lib/authz'
import { driveFileUrl, pushUploadChunk } from '../../../../lib/gdrive-files'
import {
  closeUploadRow, liveUploadRow, noteUploadProgress, recordPageUpload, requireFilesAccess,
} from '../../../../lib/drive-page'
import { UPLOAD_CHUNK } from '../../../../lib/files-core'

/**
 * One slice of a file on its way into Drive.
 *
 * The bytes are on somebody's laptop, so the browser drives the loop: ask for
 * a session, then PUT slice after slice here until Drive says it has the lot.
 * This route holds no state of its own — the session URI and how much Drive
 * has confirmed both live in `drive_uploads`, so a slice knows where it goes
 * without the browser ever holding a URI that writes into somebody's Drive.
 * A tab closed halfway is NOT picked up again: the row is left open, nothing
 * resumes it, and the person drops the file again. Half-restarting an upload
 * nobody is watching is a way to write the same file twice, and Drive has no
 * unique-name constraint to catch it.
 *
 * `received` in the reply is DRIVE's count, never ours. The browser resumes
 * from that number, which is the whole reason resumable upload exists: a slice
 * that arrived truncated costs one slice, not the file.
 *
 * When the last slice lands, the file is written into `drive_files` — after
 * Drive has it, never before. The mirror claims first because it retries; this
 * cannot be retried by anything but the person, and a row claimed for an
 * upload that then failed would be a file the page swears exists.
 */
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const me = await requireFilesAccess()
    const url = new URL(req.url)
    const uploadId = url.searchParams.get('upload') ?? ''
    const start = Number(url.searchParams.get('offset') ?? '0')
    if (!uploadId || !Number.isFinite(start) || start < 0) {
      return NextResponse.json({ error: 'That upload is no longer going' }, { status: 400 })
    }

    const row = await liveUploadRow(uploadId, me.email ?? null)
    if (!row) return NextResponse.json({ error: 'That upload is no longer going' }, { status: 404 })

    const bytes = new Uint8Array(await req.arrayBuffer())
    if (bytes.length > UPLOAD_CHUNK) {
      return NextResponse.json({ error: 'That piece of the file was too big' }, { status: 413 })
    }

    const outcome = await pushUploadChunk(row.upload_uri, bytes, start, row.size ?? null)
    if (!outcome.ok) {
      // fail safe: the row is closed, the folder is left exactly as it was,
      // and nothing is attempted again under another name
      console.error('[drive/upload] Google refused a chunk:', outcome.message)
      await closeUploadRow(uploadId, 'failed', null)
      return NextResponse.json({ error: outcome.message }, { status: 502 })
    }

    if (!outcome.done) {
      await noteUploadProgress(uploadId, outcome.received)
      return NextResponse.json({ done: false, received: outcome.received })
    }

    await closeUploadRow(uploadId, 'done', outcome.id)
    await recordPageUpload({
      driveFileId: outcome.id,
      name: row.name,
      parentId: row.parent_id,
      clientId: row.client_id ?? null,
      bytes: outcome.bytes,
      driveUrl: driveFileUrl(outcome.id),
      by: me.email ?? null,
    })
    return NextResponse.json({ done: true, id: outcome.id, bytes: outcome.bytes })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
