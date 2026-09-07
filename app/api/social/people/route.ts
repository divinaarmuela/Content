import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Client } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '@/app/lib/authz'
import { assertClientAccess } from '@/app/lib/social-schedule'
import { loadPeople } from '@/app/lib/people-analytics'

/**
 * THE PEOPLE TABLE for one client: who engaged, who followed, who reached out.
 *
 * Team only, and scoped by client the same way every other route in this
 * feature is — a person scoped to their clients cannot ask about somebody
 * else's audience. The answer carries names, faces and days and nothing else:
 * no ids belonging to the follower look, no provider name, no request count,
 * no money. Those stay server-side, as they do everywhere in this feature.
 *
 * Nothing on this path fetches from anywhere. It reads what the morning jobs
 * already wrote.
 */
export async function GET(req: Request) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const clientId = new URL(req.url).searchParams.get('clientId')
      if (!clientId || clientId === 'all') {
        return NextResponse.json({ state: 'pick_client', client: null, rows: [], post_days: [], as_of: null })
      }
      await assertClientAccess(user, clientId)
      const client = await table<Client>('clients').get(clientId)
      if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
      return NextResponse.json(await loadPeople({ id: client.id, name: client.name }))
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
