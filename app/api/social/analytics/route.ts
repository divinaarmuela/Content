import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireRole, authzErrorResponse } from '@/app/lib/authz'
import { getPublisher } from '@/app/lib/publisher'

/**
 * Cross-account analytics for the whole agency, or one client.
 *
 * Sources are fetched together and allowed to fail independently — a platform
 * that has not synced yet should leave one panel empty, not the page.
 */
export async function GET(req: Request) {
  try {
    await requireRole('editor')
    const clientId = new URL(req.url).searchParams.get('clientId')

    let q = supabase
      .from('social_accounts')
      .select('id, client_id, platform, provider_account_id, username, active')
      .eq('active', true)
    if (clientId) q = q.eq('client_id', clientId)
    const { data: accounts } = await q

    const publisher = getPublisher()
    const [daily, followers, analytics] = await Promise.all([
      publisher.dailyMetrics(),
      publisher.followerStats(),
      publisher.postAnalytics(),
    ])

    // clients, so the UI can name an account's owner without a second call
    const { data: clients } = await supabase.from('clients').select('id, name')

    return NextResponse.json({
      accounts: accounts ?? [],
      clients: clients ?? [],
      daily,
      followers,
      analytics,
      provider: { configured: publisher.configured() },
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
