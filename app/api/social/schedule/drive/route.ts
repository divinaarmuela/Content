import { NextResponse } from 'next/server'
import { withRequestCache } from '@/lib/db'
import { authzErrorResponse, requireRole } from '@/app/lib/authz'
import { loadItemForUser } from '@/app/lib/production-access'
import { assertClientAccess } from '@/app/lib/social-schedule'
import { importDriveFile, listClientDriveMedia, listDriveMedia } from '@/app/lib/schedule-drive'

// bringing a file across is a download and an upload back to back
export const maxDuration = 300

/**
 * The composer's Google Drive tab.
 *
 * GET  ?itemId=…              the pictures and video in that piece's Drive folder
 * GET  ?clientId=…            …and, for a post that has no piece yet, the
 *                             CLIENT's own Drive folder
 * POST { item_id | client_id, file_ids }
 *                             copies them into our storage and hands back slides
 *
 * Scoped through `loadItemForUser` where a piece is named and through
 * `assertClientAccess` where one is not, so Drive is never a way to see a
 * client's folder that this person may not see the work of. A POST here does
 * NOT put anything in a post: it returns files, and `/api/social/schedule/media`
 * (or `/from-upload`, for a post with no piece behind it yet) is what turns
 * them into a version.
 *
 * NOTHING HERE WRITES TO DRIVE (CLAUDE.md trap 13). "Bring across" is a read
 * and a copy into our own storage; the file in the owner's Drive is not moved,
 * renamed, re-shared or touched.
 */
export async function GET(req: Request) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const q = new URL(req.url).searchParams
      const itemId = q.get('itemId')
      const clientId = q.get('clientId')
      if (!itemId && !clientId) {
        return NextResponse.json({ error: 'Which piece or client?' }, { status: 400 })
      }
      let listing
      if (itemId) {
        await loadItemForUser(user, itemId)
        listing = await listDriveMedia(itemId)
      } else {
        await assertClientAccess(user, String(clientId))
        listing = await listClientDriveMedia(String(clientId))
      }
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
      const clientId = String(body.client_id ?? '')
      if (!itemId && !clientId) {
        return NextResponse.json({ error: 'Which piece or client?' }, { status: 400 })
      }
      // the scope check is the same either way: a person who may not see this
      // client's work may not read their Drive folder through here
      if (itemId) await loadItemForUser(user, itemId)
      else await assertClientAccess(user, clientId)

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
