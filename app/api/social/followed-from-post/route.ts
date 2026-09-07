import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { ContentItem } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../lib/authz'
import { assertClientAccess } from '../../../lib/social-schedule'
import { followedFromItem } from '../../../lib/post-interactors'
import { fromThisPostLine } from '../../../lib/followers-core'

/**
 * Who followed from this post — for one piece of work.
 *
 * GET ?item=<content item id> → { followed: [{ username, full_name,
 * profile_pic, how, followed_on }], line }. The card reads the same facts
 * live off the post's row; this is for surfaces without the subscription.
 * Scoped by the item's client.
 */
export async function GET(req: Request) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const itemId = new URL(req.url).searchParams.get('item') ?? ''
      if (!itemId) return NextResponse.json({ error: 'Say which post' }, { status: 400 })
      const item = await table<ContentItem>('content_items').get(itemId)
      if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      await assertClientAccess(user, item.client_id)
      const r = await followedFromItem(itemId)
      const followed = r?.followed ?? []
      return NextResponse.json({ item: itemId, followed, line: fromThisPostLine(followed) })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
