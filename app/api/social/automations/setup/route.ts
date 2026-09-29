import { NextResponse } from 'next/server'
import { withRequestCache } from '@/lib/db'
import { requireRole, authzErrorResponse } from '@/app/lib/authz'
import { postChoices, setupClients } from '@/app/lib/comment-automation'

/**
 * The create form's lists. No query: the clients and their Instagram/Facebook
 * accounts. `?client_id=&account_id=`: that account's posts to pick from.
 */
export async function GET(req: Request) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('account_manager')
      const url = new URL(req.url)
      const clientId = url.searchParams.get('client_id')
      const accountId = url.searchParams.get('account_id')
      if (!clientId || !accountId) return NextResponse.json({ clients: await setupClients(user) })
      const found = await postChoices(user, clientId, accountId)
      if (!found.ok) return NextResponse.json({ error: found.error }, { status: found.status })
      return NextResponse.json({ posts: found.choices, account_posts_read: found.accountPostsRead })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
