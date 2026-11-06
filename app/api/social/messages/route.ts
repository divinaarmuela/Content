import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Client, SocialAccount, InboxTouch, InboxView } from '@/lib/db-types'
import { rankClients } from '@/app/lib/inbox-clients-core'
import { requireRole, authzErrorResponse } from '@/app/lib/authz'
import { getPublisher } from '@/app/lib/publisher'
import { noteConversations, noteThread } from '@/app/lib/inbox-people'
import { assertClientAccess } from '@/app/lib/social-schedule'
import { accessibleClientIds } from '@/app/lib/production-access'
import { whoSent } from '@/app/lib/inbox-copy-core'
import { isMine, lastInboundAt, replyWindow, type InboxConversation, type InboxMessage } from '@/app/lib/inbox-core'
import { inBatches, liveThread, logReply, replyLogFor, recentReplyLog, noteClientViewed, readConversationCopy, refreshConversationPage } from '@/app/lib/inbox-copy'

/** A copy older than this is re-read from Zernio when the page asks (`refresh=1`). */
const STALE_MS = 2 * 60_000

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
      // newest activity first, with a per-person "new" count (3 Nov 2026) — from our own webhook notes, not Zernio
      const [touches, views] = await Promise.all([
        table<InboxTouch>('inbox_touches').list({ fresh: true }).catch(() => [] as InboxTouch[]),
        table<InboxView>('inbox_views').list({ fresh: true, where: v => v.user_id === user.id }).catch(() => [] as InboxView[]),
      ])
      // an account manager sees only their own clients, so their "all" is "My clients" (3 Nov 2026)
      return NextResponse.json({ clients: rankClients([...byClient.values()], touches, views), allLabel: mine === null ? 'All clients' : 'My clients' })
    }
    // THE REPLY LOG (6 Nov 2026): every reply sent from the app, newest first, for the clients this person may see
    if (params.get('log') === '1') {
      const want = params.get('clientId')
      const mine = await accessibleClientIds(user)
      if (want && want !== 'all') await assertClientAccess(user, want)
      const ids = want && want !== 'all' ? [want] : mine
      return NextResponse.json({ log: await recentReplyLog(ids, 100) })
    }
    if (conversationId) {
      if (!accountId) {
        return NextResponse.json({ error: 'accountId is required' }, { status: 400 })
      }
      // the NEWEST 50, LIVE, oldest-to-newest for reading — unsent ones taken out, and the copy corrected from it
      const messages = await liveThread(conversationId, accountId, params.get('opened') === '1') ?? []
      // a People touch only when they wrote in this thread (the list alone cannot tell who started it)
      const theirs = lastInboundAt(messages)
      if (theirs) {
        const convo = { id: conversationId, accountId, participantName: params.get('name') ?? undefined, participantUsername: params.get('username') ?? undefined }
        await noteThread(convo, theirs)
      }
      // who on the team sent each of our messages from the app — "Sent by Sam"; a message sent elsewhere has no name
      const log = await replyLogFor([conversationId])
      const sentBy: Record<string, string> = {}
      messages.forEach((m, i) => { const by = isMine(m) ? whoSent(m, conversationId, log) : null; if (by) sentBy[m.id ?? String(i)] = by })
      return NextResponse.json({ messages, sentBy, window: replyWindow(messages, Date.now()) })
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
    // OUR COPY FIRST, KEPT CURRENT BY ZERNIO (6 Nov 2026: "fast — but what if they unsent"). The list is the saved
    // copy (webhooks fold every message / edit / unsend into it as it happens); an account with no copy yet is read
    // live, ONE page; `refresh=1` re-reads the newest page of every account whose copy is over 2 minutes old (the page
    // asks for it right after showing the copy, under "Checking…"); `older=1` is "Load older" — the next page of each
    // account that has one. Unsent messages never come back: their ids are kept and the preview says so.
    const ids = scope.map(a => String(a.provider_account_id))
    const older = params.get('older') === '1'
    const refresh = params.get('refresh') === '1'
    if (clientId !== 'all') void noteClientViewed(clientId)
    let copy = await readConversationCopy(ids)
    const refreshed: InboxConversation[] = []
    if (older) {
      await inBatches(ids.filter(id => copy.cursors[id]), 4, async id => {
        const page = await refreshConversationPage(id, copy.cursors[id])
        if (page) refreshed.push(...page.list)
      })
    } else {
      const stale = refresh
        ? ids.filter(id => Date.now() - (Date.parse(copy.fetchedAt.get(id) ?? '') || 0) > STALE_MS)
        : copy.missing
      await inBatches(stale, 4, async id => {
        const page = await refreshConversationPage(id, null)
        if (page) refreshed.push(...page.list)
      })
    }
    if (refreshed.length || older || refresh || copy.missing.length) copy = await readConversationCopy(ids)
    const connectedAt = new Map(
      accounts
        .filter(a => a.connected_at)
        .map(a => [a.provider_account_id, new Date(a.connected_at).getTime()]),
    )
    // every currently-connected account, so a disconnected one's threads drop
    const connectedIds = new Set(accounts.map(a => a.provider_account_id))
    const visible = sinceConnection({ data: copy.list }, connectedAt, connectedIds)
    // a note of who was in it, for the People table — only for what was just read from Zernio
    if (refreshed.length) await noteConversations(sinceConnection({ data: refreshed }, connectedAt, connectedIds))
    const times = ids.map(id => copy.fetchedAt.get(id)).filter((t): t is string => !!t)
    const checkedAt = times.length ? times.reduce((a, b) => (a < b ? a : b)) : null
    const stale = ids.some(id => Date.now() - (Date.parse(copy.fetchedAt.get(id) ?? '') || 0) > STALE_MS)
    return NextResponse.json({
      conversations: visible, checkedAt, stale,
      hasOlder: ids.some(id => !!copy.cursors[id]),
    })
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
    const user = await requireRole('scheduler')
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
    const sent = await publisher.sendConversationMessage(conversationId, accountId, message, window.tag)
    // the log: who on the team sent it, when, and the words (6 Nov 2026) — only after Zernio accepted it
    await logReply({ kind: 'dm', teamUserId: user.id, byName: user.name ?? user.email ?? null, targetId: conversationId, accountId, text: message })
    return NextResponse.json({ sent, window: window.state })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
