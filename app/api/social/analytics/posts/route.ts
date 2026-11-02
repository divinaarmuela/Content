import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Client, SocialAccount } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '@/app/lib/authz'
import { followersFor, publishedBetween, withLivePictures } from '@/app/lib/social-analytics'

const day = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)

/**
 * ONE CHANNEL'S POSTS (2 Nov 2026). `GET ?account=<social_accounts id>&from&to` — every post that channel
 * published in those days with its numbers, including posts made on the platform itself. Read only, from Zernio.
 */
export async function GET(req: Request) {
  return withRequestCache(async () => {
    try {
      await requireRole('scheduler')
      const url = new URL(req.url)
      const from = day(url.searchParams.get('from')), to = day(url.searchParams.get('to'))
      const accountId = url.searchParams.get('account')
      if (!from || !to || !accountId) return NextResponse.json({ error: 'Pick a channel and the days to show' }, { status: 400 })

      const account = await table<SocialAccount>('social_accounts').get(accountId)
      if (!account) return NextResponse.json({ error: 'That channel is not connected' }, { status: 404 })
      const client = account.client_id ? await table<Client>('clients').get(account.client_id) : null
      const [read, followers] = await Promise.all([
        publishedBetween(from, to, { accountId: account.provider_account_id }),
        followersFor({ from, to }, [account.provider_account_id]),
      ])
      const f = followers.get(account.provider_account_id)
      const posts = await withLivePictures(
        (read?.posts ?? []).filter(p => !p.accountId || p.accountId === account.provider_account_id),
        account.provider_account_id)

      return NextResponse.json({
        channel: {
          id: account.id, platform: account.platform, username: account.username, name: account.name,
          avatar_url: account.avatar_url, active: account.active,
          followers: f?.followers ?? null, growth: f?.growth ?? null, growthSince: f?.growthSince ?? null,
        },
        client: client ? { id: client.id, name: client.name } : null,
        posts,
        complete: read?.complete ?? false,
        readable: !!read,
      })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
