import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Client } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../lib/authz'
import { syncSocialAccounts } from '../../../lib/publish'
import { isPlatform } from '../../../lib/publish-core'
import { connectLinkFor } from '../../../lib/social-connect'

/**
 * Start connecting a social account for one client, from inside our dashboard.
 *
 * Each client gets its own provider profile, so one client's connected
 * accounts are never visible to another. The profile id is minted on first
 * connect and stored on the client row.
 *
 * Connecting an account is an account-level change on the client's behalf, so
 * it is account_manager and above — not every editor.
 */
export async function POST(req: Request) {
  return withRequestCache(async () => {
  try {
    await requireRole('account_manager')
    const { clientId, platform } = await req.json()

    if (typeof clientId !== 'string' || !clientId) {
      return NextResponse.json({ error: 'clientId is required' }, { status: 400 })
    }
    if (typeof platform !== 'string' || !isPlatform(platform)) {
      return NextResponse.json({ error: `Unsupported platform "${platform}"` }, { status: 400 })
    }

    // one profile per client, minted once — see connectLinkFor
    const link = await connectLinkFor(clientId, platform)
    if ('error' in link) {
      return NextResponse.json({ error: link.error }, { status: link.status })
    }
    return NextResponse.json({ authUrl: link.authUrl })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}

/** Re-read the provider's account list for a client after they finish OAuth. */
export async function PUT(req: Request) {
  return withRequestCache(async () => {
  try {
    await requireRole('account_manager')
    const { clientId } = await req.json()
    if (typeof clientId !== 'string') {
      return NextResponse.json({ error: 'clientId is required' }, { status: 400 })
    }

    const client = await table<Client>('clients').get(clientId)
    if (!client?.social_profile_id) {
      return NextResponse.json({ error: 'This client has no connected profile yet' }, { status: 400 })
    }

    const synced = await syncSocialAccounts(clientId, client.social_profile_id)
    return NextResponse.json({ synced })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
