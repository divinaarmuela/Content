import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Client, SocialAccount } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '@/app/lib/authz'
import { assertClientAccess } from '@/app/lib/social-schedule'
import { loadPeople } from '@/app/lib/people-analytics'
import { PEOPLE_CRM_CLIENTS, crmCounts, crmRow, crmSort } from '@/app/lib/people-crm-core'

/**
 * THE PEOPLE CRM for one client (28 Sep 2026): every person on the client's Instagram, with every touch we have seen
 * — followed, liked, commented, DMed, left. Team only, scoped by client like the rest of Social, and only for the
 * clients the page is for. Nothing here fetches from anywhere: it reads what the morning look, the likes-and-comments
 * read and the Inbox webhook already wrote.
 */
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const clientId = new URL(req.url).searchParams.get('clientId') ?? ''
      if (!PEOPLE_CRM_CLIENTS.some(c => c.id === clientId)) {
        return NextResponse.json({ error: 'The People page is for Justin Engelke and Jordan Wilson for now' }, { status: 404 })
      }
      await assertClientAccess(user, clientId)
      const client = await table<Client>('clients').get(clientId)
      if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
      const [people, accounts] = await Promise.all([
        loadPeople({ id: client.id, name: client.name }),
        table<SocialAccount>('social_accounts').list().catch(() => [] as SocialAccount[]),
      ])
      // our own handles — the client's and the agency's accounts — are marked, not counted as audience
      const ours = new Set(accounts.map(a => String(a.username ?? '').replace(/^@/, '').toLowerCase()).filter(Boolean))
      const rows = crmSort(people.rows.map(r => crmRow(r, ours)))
      return NextResponse.json({
        state: people.state,
        client: { id: client.id, name: client.name },
        today: people.today,
        as_of: people.as_of,
        counts: crmCounts(rows),
        rows,
      })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
