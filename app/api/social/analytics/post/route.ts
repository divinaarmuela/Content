import { NextResponse } from 'next/server'
import { requireRole, authzErrorResponse } from '@/app/lib/authz'
import { getPublisher } from '@/app/lib/publisher'
import { readTimeline, trimPost } from '@/app/lib/social-analytics-core'

/**
 * ONE POST'S NUMBERS (2 Nov 2026). `GET ?id=<Zernio post id>` — its latest figures and how they grew day by day
 * (Zernio's post-timeline: each day's reading is the running total). Read only.
 */
export async function GET(req: Request) {
  try {
    await requireRole('scheduler')
    const id = new URL(req.url).searchParams.get('id')
    if (!id || !/^[\w-]{6,64}$/.test(id)) return NextResponse.json({ error: 'Which post?' }, { status: 400 })
    const publisher = getPublisher()
    const [one, timeline] = await Promise.all([
      publisher.postAnalytics(id).catch(() => null),
      publisher.postTimeline(id).catch(() => null),
    ])
    // one post comes back as itself: `{ postId, analytics, platformAnalytics, … }` (read live 2 Nov 2026)
    const raw = one && typeof one === 'object' ? one : null
    return NextResponse.json({ post: trimPost(raw), timeline: readTimeline(timeline) })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
