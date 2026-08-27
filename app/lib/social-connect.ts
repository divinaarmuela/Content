import 'server-only'
import { supabase } from '@/lib/supabase'
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
 * One provider profile per client, minted once. The conditional update is the
 * race guard: two people pressing connect at the same moment would each create
 * a profile, so only the first write wins and the loser adopts the stored id.
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

  const { data: client } = await supabase
    .from('clients').select('id, name, social_profile_id').eq('id', clientId).maybeSingle()
  if (!client) return { error: 'Client not found', status: 404 }

  let profileId = client.social_profile_id as string | null
  if (!profileId) {
    const created = await publisher.createProfile(client.name ?? `Client ${clientId.slice(0, 8)}`)
    const { data: won } = await supabase
      .from('clients')
      .update({ social_profile_id: created })
      .eq('id', clientId)
      .is('social_profile_id', null)
      .select('social_profile_id')
      .maybeSingle()

    if (won?.social_profile_id) {
      profileId = won.social_profile_id as string
    } else {
      const { data: fresh } = await supabase
        .from('clients').select('social_profile_id').eq('id', clientId).maybeSingle()
      profileId = (fresh?.social_profile_id as string | null) ?? created
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

  return { authUrl, clientName: (client.name as string) ?? 'the client' }
}

/** The client's own portal people — who a connect link can actually be sent to. */
export async function clientPortalUsers(
  clientId: string,
): Promise<{ id: string; name: string; email: string }[]> {
  const { data } = await supabase
    .from('team_users')
    .select('id, name, email')
    .eq('role', 'client')
    .eq('client_id', clientId)
    .eq('active_status', true)
  return (data ?? []).map(u => ({
    id: u.id as string,
    name: (u.name as string) || (u.email as string),
    email: u.email as string,
  }))
}
