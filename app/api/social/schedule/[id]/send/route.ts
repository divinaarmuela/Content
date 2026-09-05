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
 *
 * As of the ruling of 5 Sep 2026 'direct' also does the MEDIA's sign-off when
 * the client has not given one — the same `internal_review →
 * approved_for_scheduling` edge the rail's "Approve without client" pressed,
 * recorded against the same person. One request, because it was always one
 * decision. It stays 'direct' rather than growing a second mode: the caller's
 * question is "post this", and which approvals that implies is the server's
 * to work out, not the button's. A client who signs every post off is refused
 * here in plain words, whoever asks.
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
