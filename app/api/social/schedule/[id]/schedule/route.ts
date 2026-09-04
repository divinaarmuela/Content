import { NextResponse } from 'next/server'
import { withRequestCache } from '@/lib/db'
import { requireRole } from '@/app/lib/authz'
import { schedulePost, scheduleErrorResponse } from '@/app/lib/social-schedule'

// the hand-over relays media through the publish job, which is slow enough to
// need the same allowance the composer's route takes
export const maxDuration = 300

/** POST — book an approved post in with the channel. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const { id } = await params
      const post = await schedulePost(user, id)
      return NextResponse.json({ post })
    } catch (e) {
      return scheduleErrorResponse(e)
    }
  })
}
