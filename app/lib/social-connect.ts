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
export async function connectLinkFor(
  clientId: string, platform: string,
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
    const live = await clients.get(clientId)
    if (live?.social_profile_id) {
      profileId = live.social_profile_id
    } else {
      const won = await clients.update(clientId, { social_profile_id: created })
      profileId = won?.social_profile_id ?? created
    }
  }

  // Return to the social channels page. Redirecting to /dashboard/clients/[id]
  // lands on a blank 404 — no such route exists — after the user has already
  // granted access, which reads as a failure when the connection succeeded.
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const authUrl = await publisher.connectUrl({
    platform: platform as Platform,
    profileId,
    redirectUrl: `${base}/dashboard/social?connected=${platform}&clientId=${clientId}`,
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
