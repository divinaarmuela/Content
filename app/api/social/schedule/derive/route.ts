import { NextResponse } from 'next/server'
import { withRequestCache } from '@/lib/db'
import { requireRole } from '@/app/lib/authz'
import { scheduleErrorResponse } from '@/app/lib/social-schedule'
import { saveDerived } from '@/app/lib/image-derive'

// a crop re-mirrors the version into Drive, which is the same shape of work
// the media endpoint already allows for
export const maxDuration = 300

/**
 * POST — an edit that KEEPS the client's approval.
 *
 * A crop (same picture, tighter frame) or a video's cover frame and trim
 * marks. Anything that changes a pixel's colour or puts words on the picture
 * is a different picture and goes to /api/social/schedule/media instead,
 * which makes a new version and sends the piece back to the client. This
 * route cannot do that: it only ever writes into the version the file is
 * already part of.
 */
export async function POST(req: Request) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const body = await req.json().catch(() => ({}))
      const result = await saveDerived(user, {
        item_id: String(body.item_id ?? ''),
        version_number: body.version_number ?? null,
        from_url: String(body.from_url ?? ''),
        to_url: body.to_url ?? null,
        cover_url: body.cover_url ?? null,
        trim_start: body.trim_start ?? null,
        trim_end: body.trim_end ?? null,
        kind: body.kind === 'video' ? 'video' : 'crop',
      })
      return NextResponse.json(result)
    } catch (e) {
      return scheduleErrorResponse(e)
    }
  })
}
