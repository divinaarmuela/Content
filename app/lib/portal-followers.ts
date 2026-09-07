import 'server-only'
import { table } from '@/lib/db'
import type { Client } from '@/lib/db-types'
import { followersEnabled } from './follower-source'
import { followersOf, latestFinishedSnapshot } from './followers'
import { followedByItemFor } from './post-interactors'
import { dayKey, portalFollowers, settingsOf, type PortalFollowers } from './followers-core'

/**
 * The portal's Followers section — only for a client whose manager switched
 * it on, and read TOLERANTLY like the intake tab: a failure here is "no
 * Followers section", never a portal that will not load.
 *
 * What goes out is `portalFollowers()`'s shape and nothing else: names,
 * faces, the day. No ids, no statuses, no errors, no source, no cost.
 */
export async function loadPortalFollowers(clientId: string): Promise<PortalFollowers | null> {
  try {
    if (!followersEnabled()) return null
    const client = await table<Client>('clients').get(clientId)
    if (!client || !settingsOf(client).onPortal) return null
    const accounts = await table('social_accounts').list({
      by: { client_id: clientId } as never,
      where: a => (a as { platform?: string }).platform === 'instagram' && (a as { active?: boolean }).active !== false,
      limit: 1,
    })
    const account = accounts[0]
    if (!account) return null
    const [rows, latest, byItem] = await Promise.all([
      followersOf(account.id), latestFinishedSnapshot(account.id), followedByItemFor(clientId).catch(() => new Map()),
    ])
    if (!latest || latest.status === 'private') return null
    return portalFollowers({ rows, count: latest.count, today: dayKey(new Date()), latest, posts: [...byItem.values()] })
  } catch {
    return null
  }
}
