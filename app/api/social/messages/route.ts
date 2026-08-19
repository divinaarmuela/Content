import { NextResponse } from 'next/server'
import { requireRole, authzErrorResponse } from '@/app/lib/authz'
import { getPublisher } from '@/app/lib/publisher'

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
    return NextResponse.json({ conversations: await publisher.listConversations() })
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
