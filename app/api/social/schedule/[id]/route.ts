import { NextResponse } from 'next/server'
import { withRequestCache } from '@/lib/db'
import { requireRole } from '@/app/lib/authz'
import {
  loadPostForUser, scheduleErrorResponse, updatePost,
} from '@/app/lib/social-schedule'

/**
 * One planned post: read it, or save its working copy.
 *
 * Every other move (send for quality check, pass, send to the client, book, take off, edit, re-book …)
 * is `POST /api/posts/<id>/act` — the one route that moves a post (the posting rebuild, 29 Sep 2026).
 */

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const { id } = await params
      const { post, item } = await loadPostForUser(user, id)
      return NextResponse.json({
        post,
        // the piece the files came from — its title only; its status never says where the post is
        item: { id: item.id, title: item.title },
      })
    } catch (e) {
      return scheduleErrorResponse(e)
    }
  })
}

/** Save the working copy — a draft only; a time-only change on an approved post keeps its approval. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const { id } = await params
      const body = await req.json().catch(() => ({}))
      const post = await updatePost(user, id, {
        ...(body.slides === undefined ? {} : { slides: body.slides }),
        ...(body.caption === undefined ? {} : { caption: body.caption }),
        ...(body.channels === undefined ? {} : { channels: body.channels }),
        ...(body.per_channel === undefined ? {} : { per_channel: body.per_channel }),
        ...(body.scheduled_for === undefined ? {} : { scheduled_for: body.scheduled_for }),
        ...(body.note === undefined ? {} : { note: body.note }),
        ...(body.automation === undefined ? {} : { automation: body.automation }),
        ...(typeof body.expect_rev === 'number' ? { expect_rev: body.expect_rev } : {}),
      })
      return NextResponse.json({ post })
    } catch (e) {
      return scheduleErrorResponse(e)
    }
  })
}
