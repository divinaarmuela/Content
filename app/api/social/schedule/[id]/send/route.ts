import { NextResponse } from 'next/server'
import { withRequestCache } from '@/lib/db'
import { requireRole } from '@/app/lib/authz'
import { scheduleErrorResponse, sendForApproval } from '@/app/lib/social-schedule'

/**
 * POST { mode?: 'approval' | 'direct', note?, client_too? }
 *
 * 'approval' (the default) asks for the final sign-off — the hat checks and
 * the emails are `actOnPostingApproval`'s, exactly as on the item page.
 * 'direct' schedules it without asking, which only somebody who could have
 * approved it may do; the post still passes through the same state machine,
 * so nothing downstream can tell the difference except `approval_mode`.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const { id } = await params
      const body = await req.json().catch(() => ({}))
      const post = await sendForApproval(user, id, {
        note: typeof body.note === 'string' ? body.note : undefined,
        client_too: typeof body.client_too === 'boolean' ? body.client_too : undefined,
        mode: body.mode === 'direct' ? 'direct' : 'approval',
      })
      return NextResponse.json({ post })
    } catch (e) {
      return scheduleErrorResponse(e)
    }
  })
}
