import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Client, SocialAccount } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '@/app/lib/authz'
import { getPublisher } from '@/app/lib/publisher'
import { noteConversations } from '@/app/lib/inbox-people'
import { assertClientAccess } from '@/app/lib/social-schedule'
import { accessibleClientIds } from '@/app/lib/production-access'
import { mergeConversations, messageAt, nextCursor, replyWindow, type InboxMessage } from '@/app/lib/inbox-core'

/**
 * Connecting an account imports its whole DM history as thread stubs, but
 * Instagram only exposes message content for conversations active since the
 * connection — the imported ones open empty. Hide anything last active
 * before its account was connected; a hidden contact reappears the moment
 * they message the account again.
 */
export function sinceConnection(raw: unknown, connectedAt: Map<string, number>, connectedIds: Set<string>): unknown {
  const r = raw as { data?: unknown } | null
  const list = Array.isArray(r?.data) ? r.data : Array.isArray(raw) ? raw : null
  if (!list) return raw
  const filtered = list.filter(c => {
    const { accountId, updatedTime } = (c ?? {}) as { accountId?: string; updatedTime?: string }
    // A DISCONNECTED ACCOUNT'S DMS ARE GONE (the owner, 14 Sep 2026:
    // "akmal.ashwin is disconnected, so its DMs shouldn't be there"). The
    // provider still streams a once-connected account's threads; the inbox
    // shows only accounts currently in social_accounts.
    if (accountId && !connectedIds.has(accountId)) return false
    const connected = accountId ? connectedAt.get(accountId) : undefined
    if (connected === undefined || !updatedTime) return true // connected, but no time to judge — keep
    return new Date(updatedTime).getTime() >= connected
  })
  return Array.isArray(r?.data) ? { ...(r as object), data: filtered } : filtered
}

/** DM inbox: conversations across connected accounts (IG, Telegram…). */
export async function GET(req: Request) {
  return withRequestCache(async () => {
  try {
    const user = await requireRole('scheduler')
    const params = new URL(req.url).searchParams
    const conversationId = params.get('conversationId')
    const accountId = params.get('accountId')
    const publisher = getPublisher()
    // the client picker: the clients this person may see that have an account connected, with those accounts
    if (params.get('clients') === '1') {
      const [rows, clients, mine] = await Promise.all([
        table<SocialAccount>('social_accounts').list(),
        table<Client>('clients').list(),
        accessibleClientIds(user),
      ])
      const names = new Map(clients.map(c => [c.id, String(c.name ?? '')]))
      const byClient = new Map<string, { id: string; name: string; accounts: { id: string; platform: string; username: string | null }[] }>()
      for (const a of rows) {
        if (a.active === false || !a.client_id || !a.provider_account_id) continue
        if (mine !== null && !mine.includes(a.client_id)) continue
        const c = byClient.get(a.client_id) ?? { id: a.client_id, name: names.get(a.client_id) || 'Client', accounts: [] }
        c.accounts.push({ id: String(a.provider_account_id), platform: String(a.platform), username: a.username ?? a.name ?? null })
        byClient.set(a.client_id, c)
      }
      return NextResponse.json({ clients: [...byClient.values()].sort((x, y) => x.name.localeCompare(y.name)) })
    }
    if (conversationId) {
      if (!accountId) {
        return NextResponse.json({ error: 'accountId is required' }, { status: 400 })
      }
      // the NEWEST 50, oldest-to-newest for reading, and where the reply window stands now
      const raw = await publisher.conversationMessages(conversationId, accountId, { latest: true }) as { data?: InboxMessage[]; messages?: InboxMessage[] } | InboxMessage[] | null
      const newestFirst: InboxMessage[] = Array.isArray(raw) ? raw : raw?.data ?? raw?.messages ?? []
      const messages = [...newestFirst].sort((a, b) => Date.parse(messageAt(a) ?? '') - Date.parse(messageAt(b) ?? ''))
      return NextResponse.json({ messages, window: replyWindow(messages, Date.now()) })
    }
    // ONE CLIENT'S ACCOUNTS, EVERY PAGE (30 Sep 2026: the whole inbox was one page of 50 across every client — slow,
    // and Jordan showed 1 of 5). `?clientId=all` walks every connected account the person may see.
    const clientId = params.get('clientId') ?? 'all'
    const accounts = await table<SocialAccount>('social_accounts').list()
    let scope = accounts.filter(a => a.active !== false && a.provider_account_id && a.client_id)
    if (clientId !== 'all') {
      await assertClientAccess(user, clientId)
      scope = scope.filter(a => a.client_id === clientId)
    } else {
      const mine = await accessibleClientIds(user)
      if (mine !== null) scope = scope.filter(a => mine.includes(String(a.client_id)))
    }
    const pages = (await Promise.all(scope.map(a => allPages(publisher, String(a.provider_account_id))))).flat()
    const conversations = { data: mergeConversations(pages) }
    const connectedAt = new Map(
      accounts
        .filter(a => a.connected_at)
        .map(a => [a.provider_account_id, new Date(a.connected_at).getTime()]),
    )
    // every currently-connected account, so a disconnected one's threads drop
    const connectedIds = new Set(accounts.map(a => a.provider_account_id))
    const visible = sinceConnection(conversations, connectedAt, connectedIds)
    // a note of who was in it, so the People table can answer "did they also
    // reach out?" — the Inbox itself stores nothing. Nothing extra is fetched.
    await noteConversations(visible)
    return NextResponse.json({ conversations: visible })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}

/** Send a reply into a conversation, or mark it read. */
export async function POST(req: Request) {
  return withRequestCache(async () => {
  try {
    await requireRole('scheduler')
    const body = await req.json()
    const conversationId = String(body.conversationId ?? '')
    const accountId = String(body.accountId ?? '')
    if (body.action === 'read') {
      if (!conversationId || !accountId) {
        return NextResponse.json({ error: 'conversationId and accountId are required' }, { status: 400 })
      }
      return NextResponse.json({ read: await getPublisher().markConversationRead(conversationId, accountId) })
    }
    const message = String(body.message ?? '').trim()
    if (!conversationId || !accountId || !message) {
      return NextResponse.json({ error: 'conversationId, accountId and message are required' }, { status: 400 })
    }
    // META'S WINDOW, CHECKED HERE, not trusted to the page: counted from the lead's last message — within 24 h any
    // reply; 24 h–7 d a person's reply, tagged HUMAN_AGENT; after that nothing (inbox-core.replyWindow)
    const publisher = getPublisher()
    const recent = await publisher.conversationMessages(conversationId, accountId, { latest: true }).catch(() => null) as { data?: InboxMessage[]; messages?: InboxMessage[] } | InboxMessage[] | null
    const msgs: InboxMessage[] = Array.isArray(recent) ? recent : recent?.data ?? recent?.messages ?? []
    const window = replyWindow(msgs, Date.now())
    if (window.state === 'closed') return NextResponse.json({ error: window.words }, { status: 409 })
    return NextResponse.json({ sent: await publisher.sendConversationMessage(conversationId, accountId, message, window.tag), window: window.state })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}

/** Every page of one account's conversations, 100 at a time — capped, so a runaway cursor cannot hang the page. */
async function allPages(publisher: ReturnType<typeof getPublisher>, accountId: string): Promise<unknown[]> {
  const pages: unknown[] = []
  let cursor: string | null = null
  for (let i = 0; i < 10; i++) {
    const page = await publisher.listConversations({ accountId, limit: 100, cursor }).catch(() => null)
    if (!page) break
    pages.push(page)
    cursor = nextCursor(page)
    if (!cursor) break
  }
  return pages
}
