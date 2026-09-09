import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Client, SocialAccount } from '@/lib/db-types'
import { connectLinkFor } from '@/app/lib/social-connect'
import { syncSocialAccounts } from '@/app/lib/publish'
import { refreshClientAccountsHealth } from '@/app/lib/account-health'
import { connectLinkPath, isConnectable, isShareToken, parseNetworks, type ConnectedAccount } from '@/app/lib/connect-link-core'
import { needsReconnect, readStoredHealth } from '@/app/lib/account-health-core'

/**
 * THE CLIENT'S OWN CONNECT LINK — its three calls, token-authed, no Clerk.
 *
 * The token is the client's portal share token, the same credential the
 * portal link trusts; this route is deliberately absent from the middleware
 * matcher so it answers on any host with no session, exactly like /portal.
 *
 * What the token buys, and nothing more: the client's name, which networks
 * are connected (platform and handle — never a provider id or a token), a
 * sign-in URL for a network the manager ticked, and a re-read of the
 * provider's list after a sign-in. All of it is the client acting on their
 * own accounts.
 */

export const dynamic = 'force-dynamic'

async function clientFor(token: string): Promise<Client | null> {
  if (!isShareToken(token)) return null
  return (await table<Client>('clients').list({ where: r => r.share_token === token, limit: 1 }))[0] ?? null
}

/** what the page draws: platform + handle, nothing a stranger could use */
async function connectedFor(clientId: string): Promise<ConnectedAccount[]> {
  const rows = await table<SocialAccount>('social_accounts').list({ by: { client_id: clientId } })
  return rows
    .filter(a => a.active !== false)
    .map(a => ({
      platform: String(a.platform), username: a.username ?? null, name: a.name ?? null,
      // the morning check's verdict, so the client's page can offer Reconnect
      reconnect: needsReconnect(readStoredHealth((a as { health?: unknown }).health)),
    }))
}

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  return withRequestCache(async () => {
    const { token } = await ctx.params
    const client = await clientFor(token)
    if (!client) return NextResponse.json({ error: 'This link is not valid' }, { status: 404 })
    return NextResponse.json({ client: client.name, connected: await connectedFor(client.id) })
  })
}

/** start the network's sign-in; the network sends the client back to this link */
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  return withRequestCache(async () => {
    const { token } = await ctx.params
    const client = await clientFor(token)
    if (!client) return NextResponse.json({ error: 'This link is not valid' }, { status: 404 })
    const body = await req.json().catch(() => ({})) as { platform?: unknown; networks?: unknown }
    if (!isConnectable(body.platform)) {
      return NextResponse.json({ error: 'That network cannot be connected here' }, { status: 400 })
    }
    // only a network the manager ticked — the link's own list, re-read here
    // rather than trusted from the button
    const allowed = parseNetworks(typeof body.networks === 'string' ? body.networks : null)
    if (!allowed.includes(body.platform)) {
      return NextResponse.json({ error: 'That network is not on this link' }, { status: 400 })
    }
    const link = await connectLinkFor(client.id, body.platform, { path: connectLinkPath(token, allowed) })
    if ('error' in link) return NextResponse.json({ error: link.error }, { status: link.status })
    return NextResponse.json({ authUrl: link.authUrl })
  })
}

/** back from the network: re-read the provider's list into ours */
export async function PUT(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  return withRequestCache(async () => {
    const { token } = await ctx.params
    const client = await clientFor(token)
    if (!client) return NextResponse.json({ error: 'This link is not valid' }, { status: 404 })
    if (!client.social_profile_id) return NextResponse.json({ synced: 0, connected: [] })
    let synced = 0
    try {
      synced = await syncSocialAccounts(client.id, client.social_profile_id)
      // a reconnect is a token that works again: read the provider's verdict
      // now rather than showing "expired" until tomorrow's 7 am check
      await refreshClientAccountsHealth(client.id)
    } catch (e) {
      console.error('[connect-link] sync failed for', client.id, e)
    }
    return NextResponse.json({ synced, connected: await connectedFor(client.id) })
  })
}
