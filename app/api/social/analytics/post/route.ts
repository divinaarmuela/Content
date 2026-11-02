import { NextResponse } from 'next/server'
import { requireRole, authzErrorResponse } from '@/app/lib/authz'
import { getPublisher } from '@/app/lib/publisher'
import { readTimeline, trimPost } from '@/app/lib/social-analytics-core'
import { readPostDeep, refusalWords } from '@/app/lib/channel-insights-core'

/**
 * ONE POST'S NUMBERS (2 Nov 2026). `GET ?id=<Zernio post id>` — its latest figures, how they grew day by day (Zernio's
 * post-timeline: each day's reading is the running total), and what only some networks give (read live 2 Nov 2026):
 * - who watched and how long — TikTok Business connections and Facebook Reels (`readPostDeep`);
 * - an Instagram post's collaborators — only for accounts connected through Facebook Login, refused otherwise;
 * - a LinkedIn post's own numbers — unique reach and clicks, from LinkedIn's per-post call (its engagement rate
 *   counts clicks, so it is shown under its own name, not beside the general one).
 * Read only.
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
    const post = trimPost(raw)
    const deep = readPostDeep(raw)

    let collaborators: { username: string | null; status: string }[] | null = null
    let collaboratorsProblem: string | null = null
    let linkedin: Record<string, number> | null = null
    if (post?.accountId && deep.platformPostId) {
      const acc = encodeURIComponent(post.accountId)
      if (post.platform === 'instagram') {
        const r = await publisher.readAnalytics(`/accounts/${acc}/instagram/media/${encodeURIComponent(deep.platformPostId)}/collaborators`)
        if (r && r.status >= 200 && r.status < 300) {
          const list = ((r.body as { data?: unknown[] })?.data ?? []) as { username?: unknown; inviteStatus?: unknown }[]
          collaborators = list.map(c => ({ username: typeof c.username === 'string' ? c.username : null, status: String(c.inviteStatus ?? '') }))
        } else if (r) collaboratorsProblem = refusalWords(r.status, r.body, 'Instagram')
      }
      if (post.platform === 'linkedin') {
        const r = await publisher.readAnalytics(`/accounts/${acc}/linkedin-post-analytics`, { urn: deep.platformPostId })
        if (r && r.status >= 200 && r.status < 300) {
          const a = ((r.body as { analytics?: Record<string, unknown> })?.analytics ?? {})
          linkedin = {}
          for (const [k, v] of Object.entries(a)) if (typeof v === 'number') linkedin[k] = v
        }
      }
    }
    return NextResponse.json({ post, timeline: readTimeline(timeline), deep, collaborators, collaboratorsProblem, linkedin })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
