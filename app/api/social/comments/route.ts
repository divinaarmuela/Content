import { NextResponse } from 'next/server'
import { requireRole, authzErrorResponse } from '@/app/lib/authz'
import { getPublisher } from '@/app/lib/publisher'
import { noteComments } from '@/app/lib/inbox-people'
import { cachedComments, liveComments, logReply } from '@/app/lib/inbox-copy'

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
    const accountId = params.get('accountId')
    // `cached=1`: the saved copy, shown at once while the live read below runs (6 Nov 2026)
    if (params.get('cached') === '1') {
      const copy = accountId ? await cachedComments(postId, accountId) : null
      return NextResponse.json({ comments: copy?.comments ?? null, fetchedAt: copy?.fetched_at ?? null })
    }
    // LIVE, always: each comment marked replied (by whom, when) or needs a reply, and the copy corrected
    const live = await liveComments(postId, accountId)
    await noteComments(live?.raw ?? null, { accountId, postId })
    return NextResponse.json({ comments: live?.comments ?? [], fetchedAt: new Date().toISOString() })
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
    const user = await requireRole('scheduler')
    const { action, postId, commentId, message, buttons, accountId } = await req.json()

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
        const result = await publisher.replyToComment(postId, commentId, message)
        // the log: who on the team replied, when, and what (6 Nov 2026) — only after Zernio accepted it
        await logReply({ kind: 'comment', teamUserId: user.id, byName: user.name ?? user.email ?? null, targetId: commentId, postId, accountId: typeof accountId === 'string' ? accountId : null, text: message })
        return NextResponse.json({ result })
      }
      case 'private_reply': {
        if (!message?.trim()) return NextResponse.json({ error: 'Write a message first' }, { status: 400 })
        // Meta permits one private reply per comment, inside a limited window
        // after it was posted; their refusal message is passed straight back.
        const result = await publisher.privateReply(postId, commentId, message, buttons)
        await logReply({ kind: 'private_reply', teamUserId: user.id, byName: user.name ?? user.email ?? null, targetId: commentId, postId, accountId: typeof accountId === 'string' ? accountId : null, text: message })
        return NextResponse.json({ result })
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
