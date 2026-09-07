import { NextResponse } from 'next/server'
import { requireRole, authzErrorResponse } from '@/app/lib/authz'
import { getPublisher } from '@/app/lib/publisher'
import { noteComments } from '@/app/lib/inbox-people'

/**
 * Comments on one post.
 *
 * `accountId` is optional and only used to note who has been in the Inbox
 * (see `inbox-people.ts`) — the comments themselves are the same either way,
 * and nothing extra is fetched to write that note.
 */
export async function GET(req: Request) {
  try {
    await requireRole('scheduler')
    const params = new URL(req.url).searchParams
    const postId = params.get('postId')
    if (!postId) return NextResponse.json({ error: 'postId is required' }, { status: 400 })
    const comments = await getPublisher().postComments(postId)
    await noteComments(comments, { accountId: params.get('accountId'), postId })
    return NextResponse.json({ comments })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

/**
 * Act on a comment: reply publicly, reply privately by DM, hide, or delete.
 *
 * Everything here is visible to the client's audience under their name, so it
 * is account_manager and above — not every editor should be able to speak as
 * the client. Deleting is separated out as its own action rather than being
 * implied by a flag.
 */
export async function POST(req: Request) {
  try {
    await requireRole('scheduler')
    const { action, postId, commentId, message, buttons } = await req.json()

    if (typeof postId !== 'string' || typeof commentId !== 'string') {
      return NextResponse.json({ error: 'postId and commentId are required' }, { status: 400 })
    }

    const publisher = getPublisher()
    if (!publisher.configured()) {
      return NextResponse.json({ error: 'Publishing is not configured' }, { status: 503 })
    }

    switch (action) {
      case 'reply': {
        if (!message?.trim()) return NextResponse.json({ error: 'Write a reply first' }, { status: 400 })
        return NextResponse.json({ result: await publisher.replyToComment(postId, commentId, message) })
      }
      case 'private_reply': {
        if (!message?.trim()) return NextResponse.json({ error: 'Write a message first' }, { status: 400 })
        // Meta permits one private reply per comment, inside a limited window
        // after it was posted; their refusal message is passed straight back.
        return NextResponse.json({
          result: await publisher.privateReply(postId, commentId, message, buttons),
        })
      }
      case 'hide':
        return NextResponse.json({ result: await publisher.setCommentHidden(postId, commentId, true) })
      case 'unhide':
        return NextResponse.json({ result: await publisher.setCommentHidden(postId, commentId, false) })
      case 'delete':
        return NextResponse.json({ result: await publisher.deleteComment(postId, commentId) })
      default:
        return NextResponse.json({ error: `Unknown action "${action}"` }, { status: 400 })
    }
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
