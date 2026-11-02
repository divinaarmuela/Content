import { NextResponse } from 'next/server'
import { withRequestCache } from '@/lib/db'
import { authzErrorResponse, requireSignedIn } from '@/app/lib/authz'
import { splitStoryPost } from '@/app/lib/post-stage'

/**
 * POST /api/posts/<id>/split-story — a Story post with several pictures becomes one Story post per picture, a minute
 * apart, in the original's stage (Renee, 2 Nov 2026). Body `{ expect_rev }`. Answers `{ ok, postIds, words }` or
 * `{ ok: false, reason }`. Who may is the same rule as any move on the post (splitStoryPost → mayActOn).
 */
export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireSignedIn()
      const { id } = await params
      const body = await req.json().catch(() => ({})) as { expect_rev?: unknown }
      const r = await splitStoryPost(user, id, typeof body.expect_rev === 'number' ? body.expect_rev : null)
      return NextResponse.json(r, { status: r.ok ? 200 : 409 })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ ok: false, reason: error }, { status })
    }
  })
}
