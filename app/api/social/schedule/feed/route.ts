import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { SocialAccount } from '@/lib/db-types'
import { requireRole } from '@/app/lib/authz'
import { assertClientAccess } from '@/app/lib/social-schedule'
import { scheduleErrorResponse } from '@/app/lib/social-schedule'
import { feedFor } from '@/app/lib/one-portal-schedule'

/**
 * THE ACCOUNT'S OWN FEED, for the Preview and the post window's "How it sits on the client's Instagram" (the
 * owner, 24 Sep 2026, pointing at Later's visual planner). The 25 most recent posts that exist on the Instagram
 * account, including everything published outside this dashboard, so the planned posts can be judged against
 * the grid they will join.
 *
 * THE SAME FEED THE CLIENT PORTAL DRAWS (the owner, 2 Nov 2026: "like client portal"): `feedFor` is the portal's
 * own reader — the `portal_feeds` copy, refreshed from Zernio when older than 15 minutes — so the dashboard and
 * "Your feed" show the same posts, and a dashboard open does not call Zernio on every look.
 *
 * Read only towards the client's account, and never fatal: a feed that cannot be read gives an empty feed and
 * the page says so, rather than failing.
 */
export async function GET(req: Request) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const url = new URL(req.url)
      const accountId = String(url.searchParams.get('account') ?? '').trim()
      if (!accountId) return NextResponse.json({ error: 'Which account?' }, { status: 400 })

      const account = await table<SocialAccount>('social_accounts').get(accountId)
      if (!account || !account.client_id) return NextResponse.json({ error: 'Account not found' }, { status: 404 })
      await assertClientAccess(user, account.client_id)
      if (account.platform !== 'instagram') return NextResponse.json({ tiles: [], reason: 'not_instagram' })

      const providerId = String((account as { provider_account_id?: string }).provider_account_id ?? '')
      if (!providerId) return NextResponse.json({ tiles: [], reason: 'not_connected' })

      const { tiles, problem } = await feedFor(account, new Date())
      return NextResponse.json({
        tiles,
        handle: account.username ?? null,
        ...(problem ? { reason: 'unreadable' as const } : {}),
      })
    } catch (e) {
      return scheduleErrorResponse(e)
    }
  })
}
