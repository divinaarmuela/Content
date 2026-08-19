import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
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
    const [conversations, { data: accounts }] = await Promise.all([
      publisher.listConversations(),
      supabase.from('social_accounts').select('provider_account_id, connected_at'),
    ])
    const connectedAt = new Map(
      (accounts ?? [])
        .filter(a => a.connected_at)
        .map(a => [a.provider_account_id as string, new Date(a.connected_at as string).getTime()]),
    )
    return NextResponse.json({ conversations: sinceConnection(conversations, connectedAt) })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

/** Send a reply into a conversation. */
export async function POST(req: Request) {
  try {
    await requireRole('scheduler')
    const body = await req.json()
    const conversationId = String(body.conversationId ?? '')
    const accountId = String(body.accountId ?? '')
    const message = String(body.message ?? '').trim()
    if (!conversationId || !accountId || !message) {
      return NextResponse.json({ error: 'conversationId, accountId and message are required' }, { status: 400 })
    }
    return NextResponse.json({ sent: await getPublisher().sendConversationMessage(conversationId, accountId, message) })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
