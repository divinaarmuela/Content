import { NextResponse } from 'next/server'
import { withRequestCache } from '@/lib/db'
import { authzErrorResponse, requireSignedIn } from '@/app/lib/authz'
import { parsePostActRequest, refusalStatus } from '@/app/lib/post-act-contract'
import { actOnPost } from '@/app/lib/post-stage'

/**
 * POST /api/posts/<id>/act — THE ONE WAY A TEAM MEMBER MOVES A POST (SPEC §5).
 *
 * Body: `{ action, expect_rev, version?, note?, scheduled_for?, approve_by?, agreed_via?, assign_to?,
 * confirm?, steps?, send_to?, via?, reason? }` (app/lib/post-act-contract.ts).
 *
 * Answers `{ ok: true, post, stage, words }`, or a refusal `{ ok: false, code, reason, post }` with the
 * fresh post so the page redraws from what the server holds: 403 when this person may not do it, 404 for
 * no such post, 400 for a body that is not a request, 409 for everything else (a stale page, a stage
 * where this cannot happen, a booking the channel refused).
 *
 * Who may do what is decided on the server, per post, from the person's hats and the post's stage
 * (app/lib/post-stage-core.ts) — a hidden button is presentation, not security. The move itself is
 * app/lib/post-stage.ts, the only writer of a post's stage.
 */
export const dynamic = 'force-dynamic'
// a booking hands the files to the provider through the publish job, which can take a while
export const maxDuration = 300

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireSignedIn()
      const { id } = await params
      const body = await req.json().catch(() => null)
      const parsed = parsePostActRequest(body)
      if (!parsed.ok) {
        return NextResponse.json({ ok: false, code: 'bad_request', reason: parsed.reason, post: null }, { status: 400 })
      }
      const result = await actOnPost(user, id, parsed.request)
      return NextResponse.json(result, { status: result.ok ? 200 : refusalStatus(result.code) })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ ok: false, code: status === 403 ? 'not_allowed' : 'bad_request', reason: error, post: null }, { status })
    }
  })
}
