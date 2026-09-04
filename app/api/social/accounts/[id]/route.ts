import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { SocialAccount, Client } from '@/lib/db-types'
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
  return withRequestCache(async () => {
  try {
    await requireRole('scheduler')
    const { id } = await params

    // our row first — it carries the client link, which is what makes this
    // account "belong" to someone
    const row = await table<SocialAccount>('social_accounts').get(id)
    if (!row) return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    // the columns the old select named, and no others
    const account = {
      id: row.id, client_id: row.client_id, platform: row.platform,
      provider_account_id: row.provider_account_id, name: row.name,
      username: row.username, avatar_url: row.avatar_url, active: row.active,
      connected_at: row.connected_at,
    }

    const clientRow = account.client_id ? await table<Client>('clients').get(account.client_id) : null
    const client = clientRow ? { id: clientRow.id, name: clientRow.name } : null

    const publisher = getPublisher()
    const providerId = account.provider_account_id
    const platform = account.platform

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
  })
}

/**
 * Rename an account for OUR screens.
 *
 * Only the display name, and only ours: the platform's handle belongs to the
 * platform and is re-read from it on every sync, so writing it here would be
 * overwritten within the hour and would misname the account in the meantime.
 * The name is what a scheduler reads on a tile at 11px, and "Acme — main" is
 * a great deal more use there than a duplicate of the handle underneath it.
 *
 * The posting time zone is NOT here on purpose: every time on Schedule is the
 * CLIENT's zone (`clients.timezone`), because a posting time is a fact about
 * the audience rather than about one channel. A per-account zone would be a
 * second answer to the same question.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRequestCache(async () => {
    try {
      await requireRole('scheduler')
      const { id } = await params
      const body = await req.json().catch(() => ({})) as { name?: unknown }
      if (typeof body.name !== 'string') {
        return NextResponse.json({ error: 'Give the account a name' }, { status: 400 })
      }
      const name = body.name.trim().slice(0, 80)

      // claim, not check-then-write: two people renaming at once resolve to
      // one answer rather than one silently overwriting the other
      const saved = await table<SocialAccount>('social_accounts').claim(id, cur =>
        cur ? { ...cur, name: name || null } : null)
      if (!saved.claimed) {
        return NextResponse.json({ error: 'That account is no longer connected' }, { status: 404 })
      }
      return NextResponse.json({ ok: true, name: saved.row.name })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
