import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Client, SocialAccount } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '@/app/lib/authz'
import { assertClientAccess } from '@/app/lib/social-schedule'
import { loadPeople } from '@/app/lib/people-analytics'
import { PEOPLE_CRM_CLIENTS, crmCounts, crmRow, crmSort, readAtFromThread, readAutomationTouches, withAutomationTouches, type AutomationTouch } from '@/app/lib/people-crm-core'
import { getPublisher } from '@/app/lib/publisher'

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
      const touches = await automationTouches(accounts.filter(a => a.client_id === clientId))
      const rows = crmSort(withAutomationTouches(people.rows.map(r => crmRow(r, ours)), touches))
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

/**
 * The comment-to-DM automations on this client's accounts, read from Zernio with each one's per-person log. Zernio not
 * answering is not an error for the page: the rest of the CRM still shows, without the automation lines.
 */
async function automationTouches(accounts: readonly SocialAccount[]): Promise<AutomationTouch[]> {
  const ids = new Set(accounts.map(a => String(a.provider_account_id ?? '')).filter(Boolean))
  if (ids.size === 0) return []
  try {
    const publisher = getPublisher()
    const list = await publisher.listAutomations() as { automations?: { id?: string; accountId?: string }[] } | null
    const mine = (list?.automations ?? []).filter(a => a.id && ids.has(String(a.accountId ?? '')))
    const logs: Record<string, unknown> = {}
    await Promise.all(mine.map(async a => { logs[String(a.id)] = await publisher.automationLogs(String(a.id)).catch(() => null) }))
    const touches = readAutomationTouches(list, logs, ids)
    // whether each DM was read — on Instagram the conversation's id is the commenter's; capped, one read per DM sent
    const sent = touches.filter(t => t.outcome === 'sent' && t.commenter_id).slice(0, 60)
    await Promise.all(sent.map(async t => {
      const thread = await publisher.conversationMessages(String(t.commenter_id), t.account_id, { latest: true }).catch(() => null)
      t.read_at = readAtFromThread(thread, t.at)
    }))
    return touches
  } catch (e) {
    console.error('[people-crm] automations:', e instanceof Error ? e.message : e)
    return []
  }
}
