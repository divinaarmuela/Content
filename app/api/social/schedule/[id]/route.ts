import { NextResponse } from 'next/server'
import { withRequestCache } from '@/lib/db'
import { requireRole } from '@/app/lib/authz'
import {
  cancelPost, loadPostForUser, scheduleErrorResponse, updatePost,
} from '@/app/lib/social-schedule'

/** One planned post: read it, change it, or take it off the calendar. */

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const { id } = await params
      const { post, item } = await loadPostForUser(user, id)
      return NextResponse.json({
        post,
        item: {
          id: item.id, title: item.title, status: item.status,
          posting_approval_state: item.posting_approval_state ?? null,
        },
      })
    } catch (e) {
      return scheduleErrorResponse(e)
    }
  })
}

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
      })
      return NextResponse.json({ post })
    } catch (e) {
      return scheduleErrorResponse(e)
    }
  })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const { id } = await params
      const post = await cancelPost(user, id)
      return NextResponse.json({ post })
    } catch (e) {
      return scheduleErrorResponse(e)
    }
  })
}
