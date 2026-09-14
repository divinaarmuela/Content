import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { SocialAccount } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '@/app/lib/authz'
import { getPublisher } from '@/app/lib/publisher'

/** Keep only comments from a currently-connected account (the owner, 14 Sep
 *  2026: a disconnected account's comments were still showing). A comment
 *  with no account id is kept — nothing to judge it by. */
export function onlyConnected<T extends { accountId?: string }>(rows: T[], connectedIds: Set<string>): T[] {
  return rows.filter(c => !c.accountId || connectedIds.has(c.accountId))
}

/** Posts that have comments, across every connected account. */
export async function GET() {
 return withRequestCache(async () => {
  try {
    await requireRole('scheduler')
    const publisher = getPublisher()
    if (!publisher.configured()) return NextResponse.json({ data: [], configured: false })

    const [listed, accounts] = await Promise.all([
      publisher.listComments() as Promise<{ data?: unknown[] } | null>,
      table<SocialAccount>('social_accounts').list(),
    ])
    const connectedIds = new Set(accounts.map(a => a.provider_account_id))
    const data = onlyConnected((listed?.data ?? []) as { accountId?: string }[], connectedIds)
    return NextResponse.json({ data, configured: true })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
 })
}
