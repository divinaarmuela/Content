import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { InboxView } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '@/app/lib/authz'
import { assertClientAccess } from '@/app/lib/social-schedule'

/**
 * "I have looked at this client's Inbox" (the owner, 3 Nov 2026). One row per person per client, so the client
 * list's "new" count clears for the person who opened it and nobody else. Nothing else is written, nobody is told.
 */
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  return withRequestCache(async () => {
  try {
    const user = await requireRole('scheduler')
    const body = await req.json().catch(() => ({})) as { clientId?: unknown }
    const clientId = typeof body.clientId === 'string' ? body.clientId : ''
    if (!clientId || clientId === 'all') return NextResponse.json({ error: 'clientId is required' }, { status: 400 })
    await assertClientAccess(user, clientId)
    const seen_at = new Date().toISOString()
    await table<InboxView>('inbox_views').upsert({ id: `${user.id}__${clientId}`, user_id: user.id, client_id: clientId, seen_at })
    return NextResponse.json({ seen_at })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
