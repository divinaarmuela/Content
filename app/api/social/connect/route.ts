import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireRole, authzErrorResponse } from '../../../lib/authz'
import { getPublisher } from '../../../lib/publisher'
import { syncSocialAccounts } from '../../../lib/publish'
import { isPlatform } from '../../../lib/publish-core'

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
  try {
    await requireRole('account_manager')
    const { clientId, platform } = await req.json()

    if (typeof clientId !== 'string' || !clientId) {
      return NextResponse.json({ error: 'clientId is required' }, { status: 400 })
    }
    if (typeof platform !== 'string' || !isPlatform(platform)) {
      return NextResponse.json({ error: `Unsupported platform "${platform}"` }, { status: 400 })
    }

    const publisher = getPublisher()
    if (!publisher.configured()) {
      return NextResponse.json(
        { error: 'No publishing provider is configured — set ZERNIO_API_KEY' },
        { status: 503 }
      )
    }

    const { data: client } = await supabase
      .from('clients').select('id, name, social_profile_id').eq('id', clientId).maybeSingle()
    if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

    // One profile per client, created by the provider once and reused. The id
    // is theirs to mint (a 24-char ObjectId) — a locally invented value is
    // rejected with "Invalid profile ID format".
    //
    // The conditional update is the race guard: two account managers hitting
    // connect at the same moment could each create a profile, so only the
    // first write wins and the loser adopts the stored id.
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
      platform,
      profileId,
      redirectUrl: `${base}/dashboard/social?connected=${platform}&clientId=${clientId}`,
    })

    return NextResponse.json({ authUrl })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

/** Re-read the provider's account list for a client after they finish OAuth. */
export async function PUT(req: Request) {
  try {
    await requireRole('account_manager')
    const { clientId } = await req.json()
    if (typeof clientId !== 'string') {
      return NextResponse.json({ error: 'clientId is required' }, { status: 400 })
    }

    const { data: client } = await supabase
      .from('clients').select('social_profile_id').eq('id', clientId).maybeSingle()
    if (!client?.social_profile_id) {
      return NextResponse.json({ error: 'This client has no connected profile yet' }, { status: 400 })
    }

    const synced = await syncSocialAccounts(clientId, client.social_profile_id)
    return NextResponse.json({ synced })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
