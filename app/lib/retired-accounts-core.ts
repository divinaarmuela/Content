/**
 * A DISCONNECTED CHANNEL COMES BACK AS ITSELF (30 Sep 2026). Posts, their frozen versions, automations and the
 * followers history all name a channel by its social_accounts id. Disconnect used to delete that row, and the
 * reconnect made a new one, so a booked post said "a channel is not connected" while Zernio was about to post to it.
 * Disconnect now keeps the row (social_accounts_retired); a reconnect of the same account puts it back under its id.
 *
 * The same account: the same provider id — Zernio kept Justin's — or, when the provider hands out a new one, the same
 * handle on the same network for the same client (the rule syncSocialAccounts already uses for a live row).
 */
export type RetiredAccount = {
  id: string; client_id: string | null; platform: string; provider_account_id: string; username: string | null
  row: unknown; retired_at: string
}

export function retiredMatch<T extends RetiredAccount>(
  retired: readonly T[],
  incoming: { clientId: string; platform: string; providerAccountId: string; username: string | null },
): T | null {
  const mine = retired.filter(r => r.client_id === incoming.clientId && r.platform === incoming.platform)
  const byId = mine.filter(r => r.provider_account_id === incoming.providerAccountId)
  const handle = String(incoming.username ?? '').trim().toLowerCase().replace(/^@/, '')
  const byHandle = handle ? mine.filter(r => String(r.username ?? '').trim().toLowerCase().replace(/^@/, '') === handle) : []
  const pick = byId.length ? byId : byHandle
  // the most recently disconnected, if the same account was disconnected more than once
  return [...pick].sort((a, b) => b.retired_at.localeCompare(a.retired_at))[0] ?? null
}
