import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireRole, authzErrorResponse } from '../../../../lib/authz'
import { getPublisher } from '../../../../lib/publisher'

/**
 * Everything the account page needs, in one request.
 *
 * Each panel is fetched independently and allowed to fail on its own: a
 * revoked insights scope should grey out the metrics, not blank the page. So
 * the response always has the same shape, with nulls where a source could not
 * be read, and the UI decides what to show.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireRole('scheduler')
    const { id } = await params

    // our row first — it carries the client link, which is what makes this
    // account "belong" to someone
    const { data: account } = await supabase
      .from('social_accounts')
      .select('id, client_id, platform, provider_account_id, name, username, avatar_url, active, connected_at')
      .eq('id', id)
      .maybeSingle()

    if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

    const { data: client } = account.client_id
      ? await supabase.from('clients').select('id, name').eq('id', account.client_id).maybeSingle()
      : { data: null }

    const publisher = getPublisher()
    const providerId = account.provider_account_id as string
    const platform = account.platform as string

    const [health, insights, daily, followers, posts, analytics, comments] = await Promise.all([
      publisher.accountHealth(providerId),
      publisher.accountInsights(providerId, platform),
      publisher.dailyMetrics(providerId),
      publisher.followerStats(),
      publisher.listPosts({ limit: 20 }),
      publisher.postAnalytics(),
      publisher.listComments(),
    ])

    return NextResponse.json({
      account, client, health, insights, daily, followers, posts, analytics, comments,
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
