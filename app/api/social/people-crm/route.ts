import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Client, SocialAccount } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '@/app/lib/authz'
import { assertClientAccess } from '@/app/lib/social-schedule'
import { PEOPLE_CRM_CLIENTS, crmSort, readAtFromThread, readAutomationTouches, withAutomationTouches, type AutomationTouch } from '@/app/lib/people-crm-core'
import { getPublisher } from '@/app/lib/publisher'

/**
 * WHO THE PEOPLE IN ONE CLIENT'S INBOX ARE (28 Sep 2026): each commenter's trip through the client's comment-to-DM
 * automations, read from Zernio. Team only, scoped by client like the rest of Social, and only for the clients in
 * PEOPLE_CRM_CLIENTS. The Inbox's "About this person" card reads it. (The follower and liker join this used to carry
 * was removed with the People page on 1 Oct 2026.)
 */
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const clientId = new URL(req.url).searchParams.get('clientId') ?? ''
      if (!PEOPLE_CRM_CLIENTS.some(c => c.id === clientId)) {
        return NextResponse.json({ error: 'This covers Justin Engelke, Jordan Wilson and the test client for now' }, { status: 404 })
      }
      await assertClientAccess(user, clientId)
      const client = await table<Client>('clients').get(clientId)
      if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
      const accounts = await table<SocialAccount>('social_accounts').list().catch(() => [] as SocialAccount[])
      const touches = await automationTouches(accounts.filter(a => a.client_id === clientId))
      const rows = crmSort(withAutomationTouches([], touches))
      return NextResponse.json({
        client: { id: client.id, name: client.name },
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
