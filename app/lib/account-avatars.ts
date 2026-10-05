import 'server-only'
import { table } from '@/lib/db'
import type { SocialAccount } from '@/lib/db-types'
import { getPublisher } from './publisher'

/**
 * THE PROFILE PICTURES ARE READ AGAIN (5 Oct 2026: "profile pic for insta is broken… on the client portal").
 * Instagram's picture link is signed and dies about four days after it is handed out; ours was only ever stored
 * when an account was connected, so 11 of 16 Instagram pictures were dead links (403). One call to the provider
 * for the account list, and every stored picture that differs is replaced. Called by the morning check, and by
 * the portal the moment it meets a dead one (`avatarStale`). `clientId` narrows the writes to one client.
 */
export async function refreshAvatars(clientId?: string | null): Promise<Map<string, string>> {
  const fresh = new Map<string, string>()
  const listed = await getPublisher().listAccounts().catch(() => [])
  if (listed.length === 0) return fresh
  const byProvider = new Map(listed.map(a => [String(a.providerAccountId), a.avatarUrl]))
  const ours = await table<SocialAccount>('social_accounts').list(clientId ? { by: { client_id: clientId } } : { where: a => a.active !== false })
  for (const account of ours) {
    const url = byProvider.get(String(account.provider_account_id))
    if (!url) continue
    fresh.set(account.id, url)
    if (url !== account.avatar_url) await table('social_accounts').update(account.id, { avatar_url: url }).catch(() => undefined)
  }
  return fresh
}

/** Is this stored picture link missing or past its signed expiry (`oe=` — hex seconds)? Unsigned links never go stale. */
export function avatarStale(url: string | null | undefined, nowMs: number): boolean {
  if (!url) return true
  try {
    const oe = new URL(url).searchParams.get('oe')
    if (!oe) return false
    const at = parseInt(oe, 16) * 1000
    // an hour's margin: a link about to die is as good as dead to a page left open
    return Number.isFinite(at) && at - nowMs < 60 * 60 * 1000
  } catch { return true }
}
