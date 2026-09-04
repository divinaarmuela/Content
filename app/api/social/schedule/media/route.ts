import { NextResponse } from 'next/server'
import { withRequestCache } from '@/lib/db'
import { requireRole } from '@/app/lib/authz'
import { addMediaVersion, scheduleErrorResponse } from '@/app/lib/social-schedule'

// a new version mirrors its slides into Drive and asks for a video preview,
// which is the same shape of work the versions endpoint allows for
export const maxDuration = 300

/**
 * POST { item_id, post_id?, files } — media that did not come from the
 * approved version.
 *
 * The one door for a Drive file or an upload getting into a post. It never
 * puts one there quietly: the whole arrangement becomes a new version and the
 * piece goes back to the client, which is what the picker's footer promised.
 */
export async function POST(req: Request) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const body = await req.json().catch(() => ({}))
      const result = await addMediaVersion(user, {
        item_id: String(body.item_id ?? ''),
        post_id: body.post_id ? String(body.post_id) : null,
        files: body.files,
      })
      return NextResponse.json(result)
    } catch (e) {
      return scheduleErrorResponse(e)
    }
  })
}
