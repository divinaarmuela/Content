import { NextResponse } from 'next/server'
import { withRequestCache } from '@/lib/db'
import { requireRole } from '@/app/lib/authz'
import {
  assertClientAccess, createPost, listPosts, scheduleErrorResponse,
} from '@/app/lib/social-schedule'

/**
 * The Schedule calendar's list, and starting a post.
 *
 * `requireRole('scheduler')` is the whole team (an editor sits ABOVE a
 * scheduler on the ladder), which is the design's "everyone who may see
 * Social today"; what a person may DO is decided per item inside
 * `social-schedule.ts`, from their assignment — the same rule the production
 * board follows.
 */

/** GET /api/social/schedule?clientId=…&from=…&to=… — the tiles for a week. */
export async function GET(req: Request) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const url = new URL(req.url)
      const clientId = url.searchParams.get('clientId')
      if (!clientId) return NextResponse.json({ error: 'Pick a client first' }, { status: 400 })
      await assertClientAccess(user, clientId)
      const posts = await listPosts({
        clientId,
        from: url.searchParams.get('from'),
        to: url.searchParams.get('to'),
        // scoped by the ITEM as well as by the client — the same rule the page
        // applies, so the API is not the wider of the two surfaces
        viewer: user,
      })
      return NextResponse.json({ posts })
    } catch (e) {
      return scheduleErrorResponse(e)
    }
  })
}

/** POST /api/social/schedule — start a post from an approved item. */
export async function POST(req: Request) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const body = await req.json().catch(() => ({}))
      const post = await createPost(user, {
        item_id: String(body.item_id ?? ''),
        slides: body.slides,
        caption: body.caption,
        channels: body.channels,
        per_channel: body.per_channel,
        scheduled_for: body.scheduled_for ?? null,
        timezone: body.timezone ?? null,
      })
      return NextResponse.json({ post })
    } catch (e) {
      return scheduleErrorResponse(e)
    }
  })
}
