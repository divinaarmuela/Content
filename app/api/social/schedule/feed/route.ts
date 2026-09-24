import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { SocialAccount } from '@/lib/db-types'
import { requireRole } from '@/app/lib/authz'
import { assertClientAccess } from '@/app/lib/social-schedule'
import { scheduleErrorResponse } from '@/app/lib/social-schedule'
import { getPublisher } from '@/app/lib/publisher'
import { liveTiles } from '@/app/lib/feed-preview-core'

/**
 * THE ACCOUNT'S OWN FEED, for the Preview (the owner, 24 Sep 2026, pointing
 * at Later's visual planner). The 25 most recent posts that exist on the
 * Instagram account, including everything published outside this dashboard,
 * so the planned posts can be judged against the grid they will join.
 *
 * Read only, and never fatal: a provider that cannot answer gives an empty
 * feed and the Preview says so, rather than failing the page.
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

      const raw = await getPublisher().accountPosts(providerId).catch(e => {
        console.error('[feed] could not read the account’s posts:', e)
        return null
      })
      return NextResponse.json({
        tiles: raw ? liveTiles(raw) : [],
        handle: account.username ?? null,
        ...(raw ? {} : { reason: 'unreadable' as const }),
      })
    } catch (e) {
      return scheduleErrorResponse(e)
    }
  })
}
