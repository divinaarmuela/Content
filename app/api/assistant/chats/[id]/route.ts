import { NextResponse } from 'next/server'
import { requireRole, authzErrorResponse } from '../../../../lib/authz'
import { isChatId } from '../../../../lib/assistant-core'
import { deleteChat, getChatMessages } from '../../../../lib/assistant-chats'

/** One chat's messages, resolved through the signed-in owner. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole('editor')
    const { id } = await params
    if (!isChatId(id)) return NextResponse.json({ error: 'No such chat' }, { status: 404 })
    const messages = await getChatMessages(user.clerk_user_id ?? user.email, id)
    if (messages === null) return NextResponse.json({ error: 'No such chat' }, { status: 404 })
    return NextResponse.json({ messages })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole('editor')
    const { id } = await params
    if (!isChatId(id)) return NextResponse.json({ error: 'No such chat' }, { status: 404 })
    const gone = await deleteChat(user.clerk_user_id ?? user.email, id)
    if (!gone) return NextResponse.json({ error: 'No such chat' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
