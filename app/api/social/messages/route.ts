import { NextResponse } from 'next/server'
import { requireRole, authzErrorResponse } from '@/app/lib/authz'
import { getPublisher } from '@/app/lib/publisher'

/** DM inbox: conversations across connected accounts (IG, Telegram…). */
export async function GET(req: Request) {
  try {
    await requireRole('editor')
    const conversationId = new URL(req.url).searchParams.get('conversationId')
    const publisher = getPublisher()
    if (conversationId) {
      return NextResponse.json({ messages: await publisher.conversationMessages(conversationId) })
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
    await requireRole('editor')
    const body = await req.json()
    const conversationId = String(body.conversationId ?? '')
    const message = String(body.message ?? '').trim()
    if (!conversationId || !message) {
      return NextResponse.json({ error: 'conversationId and message are required' }, { status: 400 })
    }
    return NextResponse.json({ sent: await getPublisher().sendConversationMessage(conversationId, message) })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
