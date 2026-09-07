import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Client, SocialAccount } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../../../lib/authz'
import { assertClientAccess } from '../../../../../lib/social-schedule'
import { getPublisher } from '../../../../../lib/publisher'
import { followersEnabled, followersOf, snapshotsOf } from '../../../../../lib/followers'
import { followedByItemFor } from '../../../../../lib/post-interactors'
import {
  dayKey, fromPostChip, lastLookWords, latestOf, matchesSearch, piles, refreshAllowed, settingsOf,
  type FollowerRow,
} from '../../../../../lib/followers-core'

/**
 * The Followers tab of one account: who follows, who joined, who left.
 *
 * SCOPED BY CLIENT like the account route beside it — a scheduler may read
 * it for a client they are on and nobody else's. The answer never carries
 * the source's name, an error string from it, a request count or a cost:
 * those stay on the snapshot rows, server-side. The owner's rule is that no
 * money and no provider name appears on any screen.
 *
 * `?q=` searches the All pile by handle or name; the pile is capped on the
 * wire so a 20,000-follower account does not ship 20,000 rows to a phone.
 */

const ALL_CAP = 1500

export type FollowerOnWire = {
  username: string
  full_name: string | null
  profile_pic: string | null
  is_private: boolean
  is_verified: boolean
  first_seen_at: string | null
  gone_at: string | null
  /** "liked Hero reel" — the post they interacted with after following */
  from_post: { item_id: string; chip: string } | null
}

const onWire = (r: FollowerRow, fromPost?: Map<string, { item_id: string; chip: string }>): FollowerOnWire => ({
  username: r.username, full_name: r.full_name, profile_pic: r.profile_pic,
  is_private: r.is_private, is_verified: r.is_verified,
  first_seen_at: r.first_seen_at, gone_at: r.gone_at,
  from_post: fromPost?.get(r.username.toLowerCase()) ?? null,
})

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const { id } = await params
      const q = new URL(req.url).searchParams.get('q') ?? ''

      const account = await table<SocialAccount>('social_accounts').get(id)
      if (!account || !account.client_id) return NextResponse.json({ error: 'Account not found' }, { status: 404 })
      await assertClientAccess(user, account.client_id)
      const client = await table<Client>('clients').get(account.client_id)

      const enabled = followersEnabled()
      const base = {
        enabled,
        account: { id: account.id, username: account.username, platform: account.platform, client_id: account.client_id },
        client: client ? { id: client.id, name: client.name } : null,
        settings: settingsOf(client),
        mayRefresh: user.role === 'account_manager' || user.role === 'super_admin',
      }
      if (account.platform !== 'instagram') {
        return NextResponse.json({ ...base, state: 'not_instagram' as const })
      }
      if (!enabled) return NextResponse.json({ ...base, state: 'off' as const })

      const now = new Date()
      const today = dayKey(now)
      const [rows, looks, stats, byItem] = await Promise.all([
        followersOf(account.id),
        snapshotsOf(account.id),
        // the provider's own count and growth — the same figures the account
        // page shows, so the two never disagree
        getPublisher().followerStats().catch(() => null) as Promise<unknown>,
        // who followed from which post — the chip on a new follower
        followedByItemFor(account.client_id).catch(() => new Map<string, { title: string | null; followed: { username: string; how: 'liked' | 'commented' | 'liked and commented' }[] }>()),
      ])
      const fromPost = new Map<string, { item_id: string; chip: string }>()
      for (const [itemId, { title, followed }] of byItem) {
        for (const f of followed) fromPost.set(f.username.toLowerCase(), { item_id: itemId, chip: fromPostChip(f.how, title) })
      }
      const latest = latestOf(looks)
      const finished = latestOf(looks.filter(s => s.status !== 'running'))
      const isPrivate = finished?.status === 'private' && (!latest || latest.status !== 'done')

      const p = piles(rows, today)
      const all = p.all.filter(r => matchesSearch(r, q))
      const statRow = pickStats(stats, account.provider_account_id)

      return NextResponse.json({
        ...base,
        state: isPrivate ? 'private' as const : rows.length === 0 && !latest ? 'waiting' as const : 'ready' as const,
        today,
        count: statRow?.currentFollowers ?? finished?.count ?? null,
        growth: statRow?.growth ?? null,
        following: p.following,
        lastLook: {
          words: lastLookWords(latest),
          running: latest?.status === 'running',
          day: finished?.day ?? null,
        },
        refresh: refreshAllowed(latest, now),
        piles: {
          new: p.newThisWeek.map(d => ({ day: d.day, rows: d.rows.map(r => onWire(r, fromPost)) })),
          left: p.leftThisWeek.map(r => onWire(r)),
          all: all.slice(0, ALL_CAP).map(r => onWire(r, fromPost)),
          all_total: all.length,
        },
      })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}

/** the provider's follower-stats entry for this account, loosely read */
function pickStats(stats: unknown, providerAccountId: string): { currentFollowers: number | null; growth: number | null } | null {
  if (!stats || typeof stats !== 'object') return null
  const accounts = (stats as { accounts?: unknown }).accounts
  if (!Array.isArray(accounts)) return null
  const row = accounts.find(a => a && typeof a === 'object' && (a as { _id?: unknown })._id === providerAccountId) as
    { currentFollowers?: unknown; growth?: unknown } | undefined
  if (!row) return null
  return {
    currentFollowers: typeof row.currentFollowers === 'number' ? row.currentFollowers : null,
    growth: typeof row.growth === 'number' ? row.growth : null,
  }
}
