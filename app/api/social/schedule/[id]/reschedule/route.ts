import { NextResponse } from 'next/server'
import { withRequestCache } from '@/lib/db'
import { requireRole } from '@/app/lib/authz'
import { moveToTime, scheduleErrorResponse } from '@/app/lib/social-schedule'

/**
 * POST { at, expect_rev? } — a new time, from a drag on the calendar or a typed time.
 *
 * A draft's time is saved with its working copy; a post that is Ready to post or Booked in changes time
 * through the stage rules (`change_time`: the approval is kept, a booking is moved with the provider).
 * Anything else is refused with the reason, and the answer carries the post as it now stands.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const { id } = await params
      const body = await req.json().catch(() => ({}))
      const at = String(body.at ?? body.scheduled_for ?? '')
      const moved = await moveToTime(user, id, at, typeof body.expect_rev === 'number' ? body.expect_rev : null)
      if (!moved.ok) {
        return NextResponse.json({ error: moved.reason, code: moved.code, post: moved.post }, { status: moved.code === 'not_allowed' ? 403 : 409 })
      }
      return NextResponse.json({ post: moved.post, words: moved.words })
    } catch (e) {
      return scheduleErrorResponse(e)
    }
  })
}
