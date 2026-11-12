import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Client, ContentItem, SocialPost } from '@/lib/db-types'
import { requireSignedIn, authzErrorResponse } from '@/app/lib/authz'
import { accessibleClientIds } from '@/app/lib/production-access'
import { clientCommentRows, mayReadClientComments, type CommentIn, type PostIn } from '@/app/lib/client-comments-core'

export const dynamic = 'force-dynamic'

/**
 * GET /api/social/client-comments — the clients' recent comments on posts, newest first, for the Post approval
 * page's Comments view. Account managers, quality checkers and super admins only; each sees their own clients.
 */
export async function GET() {
  return withRequestCache(async () => {
    try {
      const user = await requireSignedIn()
      if (!mayReadClientComments(user as never)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
      const [comments, posts, clients, items, mine] = await Promise.all([
        table<CommentIn>('post_comments').list({ where: r => r.author_role === 'client', fresh: true }),
        table<SocialPost>('social_posts').list(),
        table<Client>('clients').list(),
        table<ContentItem>('content_items').list(),
        accessibleClientIds(user),
      ])
      const clientName = new Map(clients.map(c => [c.id, String(c.name ?? '')]))
      const itemTitle = new Map(items.map(i => [i.id, String((i as { title?: string | null }).title ?? '')]))
      const rows = clientCommentRows({
        comments, posts: posts as unknown as PostIn[],
        clientName: id => clientName.get(id), itemTitle: id => itemTitle.get(id),
        allowed: mine === null ? null : new Set(mine),
      })
      return NextResponse.json({ rows })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
