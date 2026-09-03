import { NextResponse } from 'next/server'
import { withRequestCache } from '@/lib/db'
import { requireRole } from '@/app/lib/authz'
import { scheduleErrorResponse, sendForApproval } from '@/app/lib/social-schedule'

/** POST — ask for the final sign-off. The hat checks and the emails are
 *  `actOnPostingApproval`'s, exactly as on the item page. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const { id } = await params
      const body = await req.json().catch(() => ({}))
      const post = await sendForApproval(user, id, {
        note: typeof body.note === 'string' ? body.note : undefined,
        client_too: typeof body.client_too === 'boolean' ? body.client_too : undefined,
      })
      return NextResponse.json({ post })
    } catch (e) {
      return scheduleErrorResponse(e)
    }
  })
}
