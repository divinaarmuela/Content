import { NextResponse } from 'next/server'
import { withRequestCache } from '@/lib/db'
import { authzErrorResponse, requireSignedIn } from '@/app/lib/authz'
import { parsePostActRequest, refusalStatus } from '@/app/lib/post-act-contract'
import { actOnPost } from '@/app/lib/post-stage'
import { table } from '@/lib/db'
import type { PostComment } from '@/lib/db-types'

/** the team's moves whose words are a note for the post: asking for a change, and a manager's not-approved for the client */
const TEAM_NOTE_ACTIONS: readonly string[] = ['ask_change', 'client_ask_change', 'cancel']

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
      // A TEAM CHANGE REQUEST'S WORDS sit in the post's Notes too, in the TEAM thread — never the client's, never on the
      // portal (the owner, 2 Nov 2026: Karly's "add the Pim group credit to the caption" to Raven was emailed, but the
      // post's Notes showed nothing). The client's own answers are written the same way by the portal (portal/act).
      const said = String(parsed.request.note ?? '').trim()
      if (result.ok && said && TEAM_NOTE_ACTIONS.includes(parsed.request.action) && result.post) {
        const at = new Date().toISOString()
        await table<PostComment>('post_comments').insert({
          id: `${id}_r${result.post.rev}_team`,
          post_id: id, client_id: result.post.client_id, version: parsed.request.version ?? result.post.sent_version ?? null,
          file_url: null, slide_index: null, visibility: 'team',
          author_id: user.id, author_name: user.name || user.email, author_role: user.role,
          body: said, assigned_to: result.post.assigned_to ?? null, resolved_at: null, resolved_by: null,
          created_at: at, updated_at: at,
        } as PostComment).catch(e => console.error('change request note:', e))
      }
      return NextResponse.json(result, { status: result.ok ? 200 : refusalStatus(result.code) })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ ok: false, code: status === 403 ? 'not_allowed' : 'bad_request', reason: error, post: null }, { status })
    }
  })
}
