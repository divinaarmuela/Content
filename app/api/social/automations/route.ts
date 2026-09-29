import { NextResponse } from 'next/server'
import { withRequestCache } from '@/lib/db'
import { requireRole, authzErrorResponse, roleSatisfies } from '@/app/lib/authz'
import { createForPost, listForView, postAutomationState } from '@/app/lib/comment-automation'

/**
 * Comment-to-DM automations, ONE POST EACH (app/lib/comment-automation-core.ts
 * has the rule). Schedulers may look; account managers and super admins set
 * them up, switch them on and off, and delete them. `?post_id=` answers for
 * one post — the post window's "waiting for the post" / "live · 12 DMs".
 */
export async function GET(req: Request) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const postId = new URL(req.url).searchParams.get('post_id')
      if (postId) {
        const state = await postAutomationState(user, postId)
        if (!state.ok) return NextResponse.json({ error: state.error }, { status: state.status })
        return NextResponse.json({ rows: state.rows })
      }
      const view = await listForView(user)
      return NextResponse.json({ ...view, can_manage: roleSatisfies(user.role, 'account_manager') })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}

/** Switch one on for one post. The browser sends the post's KEY; the server finds the post itself. */
export async function POST(req: Request) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('account_manager')
      const body = await req.json().catch(() => null)
      const made = await createForPost(user, body)
      if (!made.ok) return NextResponse.json({ error: made.error }, { status: made.status })
      return NextResponse.json({ automation: made.row }, { status: 201 })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
