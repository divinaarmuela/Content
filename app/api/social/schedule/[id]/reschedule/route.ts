import { NextResponse } from 'next/server'
import { withRequestCache } from '@/lib/db'
import { requireRole } from '@/app/lib/authz'
import { reschedule, scheduleErrorResponse } from '@/app/lib/social-schedule'

/**
 * POST { at } — move a post.
 *
 * A refusal here is a plain sentence and a 409, because the tile has to snap
 * back to where it was and say why.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const { id } = await params
      const body = await req.json().catch(() => ({}))
      const at = String(body.at ?? body.scheduled_for ?? '')
      const moved = await reschedule(user, id, at)
      if (!moved.ok) return NextResponse.json({ error: moved.error }, { status: 409 })
      return NextResponse.json({ post: moved.post, mode: moved.mode })
    } catch (e) {
      return scheduleErrorResponse(e)
    }
  })
}
