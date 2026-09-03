import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { SocialAccount } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '@/app/lib/authz'
import { getPublisher } from '@/app/lib/publisher'

/**
 * Connecting an account imports its whole DM history as thread stubs, but
 * Instagram only exposes message content for conversations active since the
 * connection — the imported ones open empty. Hide anything last active
 * before its account was connected; a hidden contact reappears the moment
 * they message the account again.
 */
function sinceConnection(raw: unknown, connectedAt: Map<string, number>): unknown {
  const r = raw as { data?: unknown } | null
  const list = Array.isArray(r?.data) ? r.data : Array.isArray(raw) ? raw : null
  if (!list) return raw
  const filtered = list.filter(c => {
    const { accountId, updatedTime } = (c ?? {}) as { accountId?: string; updatedTime?: string }
    const connected = accountId ? connectedAt.get(accountId) : undefined
    if (connected === undefined || !updatedTime) return true // can't judge — keep
    return new Date(updatedTime).getTime() >= connected
  })
  return Array.isArray(r?.data) ? { ...(r as object), data: filtered } : filtered
}

/** DM inbox: conversations across connected accounts (IG, Telegram…). */
export async function GET(req: Request) {
  return withRequestCache(async () => {
  try {
    await requireRole('scheduler')
    const params = new URL(req.url).searchParams
    const conversationId = params.get('conversationId')
    const accountId = params.get('accountId')
    const publisher = getPublisher()
    if (conversationId) {
      if (!accountId) {
        return NextResponse.json({ error: 'accountId is required' }, { status: 400 })
      }
      return NextResponse.json({ messages: await publisher.conversationMessages(conversationId, accountId) })
    }
    const [conversations, accounts] = await Promise.all([
      publisher.listConversations(),
      table<SocialAccount>('social_accounts').list(),
    ])
    const connectedAt = new Map(
      accounts
        .filter(a => a.connected_at)
        .map(a => [a.provider_account_id, new Date(a.connected_at).getTime()]),
    )
    return NextResponse.json({ conversations: sinceConnection(conversations, connectedAt) })
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
    return NextResponse.json({ sent: await getPublisher().sendConversationMessage(conversationId, accountId, message) })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
