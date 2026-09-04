import { NextResponse } from 'next/server'
import { withRequestCache } from '@/lib/db'
import { authzErrorResponse, requireRole } from '@/app/lib/authz'
import { loadItemForUser } from '@/app/lib/production-access'
import { importDriveFile, listDriveMedia } from '@/app/lib/schedule-drive'

// bringing a file across is a download and an upload back to back
export const maxDuration = 300

/**
 * The composer's Google Drive tab.
 *
 * GET  ?itemId=…            the pictures and video in that piece's Drive folder
 * POST { item_id, file_ids } copies them into our storage and hands back slides
 *
 * Both are scoped through `loadItemForUser`, so Drive is never a way to see a
 * client's folder that this person may not see the work of. A POST here does
 * NOT put anything in a post: it returns files, and `/api/social/schedule/media`
 * is what turns them into a version the client has to approve.
 */
export async function GET(req: Request) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const itemId = new URL(req.url).searchParams.get('itemId')
      if (!itemId) return NextResponse.json({ error: 'Which piece?' }, { status: 400 })
      await loadItemForUser(user, itemId)
      const listing = await listDriveMedia(itemId)
      return listing.ok
        ? NextResponse.json({ files: listing.files })
        : NextResponse.json({ error: listing.message }, { status: 200 })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}

export async function POST(req: Request) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const body = await req.json().catch(() => ({}))
      const itemId = String(body.item_id ?? '')
      if (!itemId) return NextResponse.json({ error: 'Which piece?' }, { status: 400 })
      await loadItemForUser(user, itemId)

      const ids = (Array.isArray(body.file_ids) ? body.file_ids : []).map(String).slice(0, 20)
      if (ids.length === 0) return NextResponse.json({ error: 'Pick a file first' }, { status: 400 })

      // one at a time: each one is a whole file through this function, and
      // twenty at once is how a request runs out of memory
      const slides = []
      for (const id of ids) {
        const brought = await importDriveFile(id)
        // the first refusal is the answer — carrying on would hand back a
        // partial set with no way for the person to tell which one is missing
        if (!brought.ok) return NextResponse.json({ error: brought.message }, { status: 422 })
        slides.push(brought.slide)
      }
      return NextResponse.json({ files: slides })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
