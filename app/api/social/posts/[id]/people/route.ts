import { NextResponse } from 'next/server'
import { withRequestCache } from '@/lib/db'
import { requireRole, authzErrorResponse } from '../../../../../lib/authz'
import { loadPostPage } from '../../../../../lib/post-page'
import { followersEnabled } from '../../../../../lib/follower-source'
import { crossFollowersWithPosts, readPostInteractors } from '../../../../../lib/post-interactors'

/**
 * POST → read who liked and who commented on this post NOW.
 *
 * The morning look reads every post's people once a day at 6 am; until it
 * came round the post page could only say "check back tomorrow". The owner,
 * the night four posts went out: "why can't [it] fetch … who liked". So a
 * manager can ask for the read on the spot. Same reader, same rows, same
 * cost (a handful of requests) — just not made to wait for the morning.
 *
 * Gated by the post's own access rule (`loadPostPage`) and by the manager
 * floor: it spends money, and a scheduler reads the answer either way.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('account_manager')
      const { id } = await params
      if (!followersEnabled()) return NextResponse.json({ error: 'Not switched on.' }, { status: 400 })
      const page = await loadPostPage(user, id)
      const body = await req.json().catch(() => ({})) as { analytics_id?: unknown }
      const wanted = typeof body.analytics_id === 'string' ? body.analytics_id : page.analytics[0]?.id
      const row = page.analytics.find(a => a.id === wanted)
      if (!row) return NextResponse.json({ error: 'This post has not been read by the analytics sweep yet — give it a few minutes after it goes live.' }, { status: 409 })
      if (String(row.platform) !== 'instagram') {
        return NextResponse.json({ error: 'Only Instagram says who liked a post.' }, { status: 400 })
      }
      const result = await readPostInteractors(row.id, { force: true })
      if (result.status === 'failed') return NextResponse.json({ error: peopleReadError(result.reason) }, { status: 502 })
      if (result.status === 'skipped') return NextResponse.json({ error: result.reason ?? 'A read is already under way.' }, { status: 409 })
      // …and the cross — who of these FOLLOWED after the post went out — is
      // recomputed now too, rather than waiting for the next followers look
      const accountId = String((row as { account_id?: unknown }).account_id ?? '')
      const crossed = accountId ? await crossFollowersWithPosts(accountId).catch(() => null) : null
      return NextResponse.json({
        ok: true, likers: result.likers ?? 0, commenters: result.commenters ?? 0,
        followed: crossed?.followed ?? null,
      })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}

/**
 * The reader's own error codes, in words. `http_404` is the one seen in
 * anger: the reel at 20:16 on 8 Sep 2026 was asked about minutes after it
 * went out and the provider had not indexed it yet — the same request an
 * hour later returned 200 with the likers. So it is "not yet", not "broken".
 */
export function peopleReadError(reason: string | null | undefined): string {
  switch (reason) {
    case 'http_404': return 'Instagram has not made this post readable yet — it usually takes a little while after it goes out. Try again in a few minutes.'
    case 'http_401': case 'http_403': return 'The follower reader refused the key — check HIKER_API_KEY.'
    case 'http_429': return 'The follower reader is rate-limited right now — try again in a minute.'
    case 'bad_media': case 'bad_likers': case 'bad_comments': return 'The follower reader answered in a shape the app does not understand.'
    default: return reason ? `Could not read the people (${reason}).` : 'Could not read the people.'
  }
}
