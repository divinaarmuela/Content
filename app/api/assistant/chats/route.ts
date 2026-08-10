import { NextResponse } from 'next/server'
import { requireRole, authzErrorResponse } from '../../../lib/authz'
import { listChats } from '../../../lib/assistant-chats'

/** The signed-in person's chat list, newest first. Nobody sees anyone else's. */
export async function GET() {
  try {
    const user = await requireRole('editor')
    const chats = await listChats(user.clerk_user_id ?? user.email)
    return NextResponse.json({ chats })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
