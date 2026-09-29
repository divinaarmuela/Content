import { NextResponse } from 'next/server'
import { withRequestCache } from '@/lib/db'
import { authzErrorResponse, requireRole } from '@/app/lib/authz'
import { refusalStatus } from '@/app/lib/post-act-contract'
import { sendRoundToClient } from '@/app/lib/post-stage'

/**
 * POST /api/posts/round — SEVERAL POSTS TO ONE CLIENT, IN ONE EMAIL (the owner's decision 15).
 *
 * Body: `{ client_id, posts: [{ post_id, expect_rev, version }], send_to: [email], note?, approve_by? }`.
 *
 * Each post makes its own move through the one writer (app/lib/post-stage.ts): "Passed — send to client"
 * from the quality check, or "Send to client" once it passed. Every post is claimed first; if any of them
 * cannot go, nothing is sent. Then one email per person lists them all and opens on the client's page of
 * everything waiting on them. Who may press is decided per post on the server, from the stage rules.
 */
export const dynamic = 'force-dynamic'

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export async function POST(req: Request) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const body = await req.json().catch(() => null)
      if (!isObj(body) || typeof body.client_id !== 'string' || !Array.isArray(body.posts)) {
        return NextResponse.json({ ok: false, code: 'bad_request', reason: 'Tick the posts to send, and who to send them to.' }, { status: 400 })
      }
      const posts: { post_id: string; expect_rev: number; version: number | null }[] = []
      for (const p of body.posts) {
        if (!isObj(p) || typeof p.post_id !== 'string' || typeof p.expect_rev !== 'number' || !Number.isInteger(p.expect_rev)) {
          return NextResponse.json({ ok: false, code: 'bad_request', reason: 'The page did not say which copy of each post it had. Reload and try again.' }, { status: 400 })
        }
        posts.push({ post_id: p.post_id, expect_rev: p.expect_rev, version: typeof p.version === 'number' ? p.version : null })
      }
      const sendTo = Array.isArray(body.send_to) ? body.send_to.filter((x): x is string => typeof x === 'string') : []
      const approveBy = typeof body.approve_by === 'string' && Number.isFinite(Date.parse(body.approve_by))
        ? new Date(body.approve_by).toISOString() : null
      const result = await sendRoundToClient(user, {
        client_id: body.client_id,
        posts,
        send_to: sendTo,
        note: typeof body.note === 'string' ? body.note.slice(0, 4000) : null,
        approve_by: approveBy,
      })
      return NextResponse.json(result, { status: result.ok ? 200 : refusalStatus(result.code) })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ ok: false, code: status === 403 ? 'not_allowed' : 'bad_request', reason: error }, { status })
    }
  })
}
