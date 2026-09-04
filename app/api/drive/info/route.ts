import { NextResponse } from 'next/server'
import { authzErrorResponse } from '../../../lib/authz'
import { entryDetail } from '../../../lib/gdrive-files'
import { mirrorFactsFor, requireFilesAccess } from '../../../lib/drive-page'
import { isDriveId } from '../../../lib/files-core'
import { previewFor } from '../../../lib/stream'
import { streamThumbnailUrl } from '../../../lib/stream-core'
import { table } from '@/lib/db'
import type { DriveFile } from '@/lib/db-types'

/**
 * Everything the info panel shows about one file.
 *
 * Two halves that must not be confused. Drive answers name, size, owner and
 * when it last changed — facts about the file. `drive_files` answers client,
 * piece and version — facts about OUR work, and only for the files this app
 * put there. Most of what is in the owner's Drive was filed by a person long
 * before any of this existed, so the second half is usually empty and the
 * panel simply says less rather than inventing a client for a stranger's PDF.
 */
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    await requireFilesAccess()
    const id = new URL(req.url).searchParams.get('id') ?? ''
    if (!isDriveId(id)) {
      return NextResponse.json({ error: 'That file could not be found' }, { status: 400 })
    }
    const detail = await entryDetail(id)
    if (!detail.ok) return NextResponse.json({ error: detail.message }, { status: 502 })

    const facts = (await mirrorFactsFor([id])).get(id) ?? null

    // a video we mirrored has a Cloudflare Stream poster, which is a real
    // frame from the clip rather than Drive's grey film-strip icon
    let poster: string | null = null
    if (facts) {
      const row = (await table<DriveFile>('drive_files').list({
        where: r => r.drive_file_id === id, limit: 1,
      }))[0] ?? null
      if (row?.source_url && !row.source_url.startsWith('drive://')) {
        poster = streamThumbnailUrl(await previewFor(row.source_url), { height: 400 })
      }
    }

    return NextResponse.json({ entry: detail.entry, mirror: facts, poster })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
