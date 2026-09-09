import 'server-only'
import { table } from '@/lib/db'
import type { Client, TeamUser } from '@/lib/db-types'
import { getPublisher } from './publisher'
import { isPlatform, type Platform } from './publish-core'

/**
 * Minting the link a client follows to connect one of their own accounts.
 *
 * Shared by the two places that need it: the channels page, where somebody
 * with the client's login connects it there and then, and the posting card,
 * which emails the same link to the client because the agency does not have
 * their password and should not want it.
 *
 * One provider profile per client, minted once. Two people pressing connect at
 * the same moment would each mint a profile, so the client row is re-read
 * after the write and whichever id is stored there is the one both of them
 * use — the loser adopts it rather than carrying its own.
 */
/** Where the network sends the person back once they have said yes: one of
 *  our pages by name, or an exact path (the client's own connect link, which
 *  carries a token and the ticked networks). */
export type ConnectReturn = 'social' | 'schedule' | { path: string }

/** The page for a return, WITH the client and the network, so the page can
 *  re-read the provider's account list and say what just connected. */
export function connectReturnPath(returnTo: ConnectReturn, clientId: string, platform: string): string {
  const q = `connected=${encodeURIComponent(platform)}&clientId=${encodeURIComponent(clientId)}`
  if (typeof returnTo === 'object') {
    // an exact path on OUR site only — never an address somebody else chose
    const path = returnTo.path.startsWith('/') && !returnTo.path.startsWith('//') ? returnTo.path : '/'
    return `${path}${path.includes('?') ? '&' : '?'}${q}`
  }
  return returnTo === 'schedule'
    ? `/dashboard/social/schedule?client=${encodeURIComponent(clientId)}&${q}`
    : `/dashboard/social?${q}`
}

export async function connectLinkFor(
  clientId: string, platform: string, returnTo: ConnectReturn = 'social',
): Promise<{ authUrl: string; clientName: string } | { error: string; status: number }> {
  if (!isPlatform(platform)) {
    return { error: `Unsupported platform "${platform}"`, status: 400 }
  }

  const publisher = getPublisher()
  if (!publisher.configured()) {
    return { error: 'No publishing provider is configured — set ZERNIO_API_KEY', status: 503 }
  }

  const clients = table<Client>('clients')
  const client = await clients.get(clientId)
  if (!client) return { error: 'Client not found', status: 404 }

  let profileId = client.social_profile_id
  if (!profileId) {
    const created = await publisher.createProfile(client.name ?? `Client ${clientId.slice(0, 8)}`)
    // ONE conditional write on the client row: it lands only while the column
    // is still empty. Reading it and then writing would let the loser
    // overwrite the winner's id, and the two of them would then be connecting
    // accounts to different provider profiles.
    const mint = await clients.claim(clientId, cur =>
      cur && cur.social_profile_id == null ? { ...cur, social_profile_id: created } : null)
    // the loser adopts the id that is actually stored, never its own
    profileId = (mint.claimed ? mint.row.social_profile_id : mint.current?.social_profile_id) ?? created
  }

  // Return to the page the person STARTED on. The Social channels page by
  // default; the Schedule page when the press was one of its channel icons
  // (the owner, 9 Sep 2026: "I clicked the Facebook icon on Schedule and it
  // brought me to the Social page instead of connecting it here"). A
  // scheduler cannot even see the Social channels page, so for them the
  // old return was a refusal after a success. Redirecting to
  // /dashboard/clients/[id] lands on a 404 — no such route exists.
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const authUrl = await publisher.connectUrl({
    platform: platform as Platform,
    profileId,
    redirectUrl: `${base}${connectReturnPath(returnTo, clientId, platform)}`,
  })

  return { authUrl, clientName: client.name ?? 'the client' }
}

/** The client's own portal people — who a connect link can actually be sent to. */
export async function clientPortalUsers(
  clientId: string,
): Promise<{ id: string; name: string; email: string }[]> {
  const rows = await table<TeamUser>('team_users').list({
    by: { client_id: clientId, role: 'client', active_status: true },
  })
  return rows.map(u => ({
    id: u.id,
    name: u.name || u.email,
    email: u.email,
  }))
}
