import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { ItemComment } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../../../../../lib/authz'
import { loadItemForUser } from '../../../../../../../lib/production-access'
import { visibleComments } from '../../../../../../../lib/comment-access-core'
import { isReactionEmoji, reactionsOf, toggleReaction } from '../../../../../../../lib/comment-reactions-core'

/**
 * Toggle one emoji reaction on one comment for the signed-in team member
 * (the owner, 22 Oct 2026: "also in comments can u please add reactions").
 * Body: `{ emoji }` — one of REACTION_EMOJIS, nothing else is stored.
 *
 * Team only (a client does not react from here), on a card this person can
 * open, on a comment they can read. The toggle is a claim() — read, flip,
 * conditional write, retried on a lost race — so two people reacting at
 * once both land. No email, no bell: a reaction notifies nobody.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string; commentId: string }> }) {
  return withRequestCache(async () => {
  try {
    const user = await requireRole('scheduler')
    const { id, commentId } = await params
    await loadItemForUser(user, id)
    const body = await req.json().catch(() => ({}))
    const emoji = (body as { emoji?: unknown })?.emoji
    if (!isReactionEmoji(emoji)) return NextResponse.json({ error: 'That reaction is not one of the choices' }, { status: 400 })

    const comments = table<ItemComment>('item_comments')
    const existing = await comments.get(commentId, { fresh: true })
    const readable = existing && existing.item_id === id && visibleComments(user.role, user.id, [{
      id: existing.id, author_id: existing.author_id ?? null, visibility: String(existing.visibility ?? 'internal'),
      assigned_to: existing.assigned_to ?? null, parent_id: existing.parent_id ?? null,
    }]).length > 0
    if (!readable) return NextResponse.json({ error: 'That comment is not on this item' }, { status: 404 })

    const result = await comments.claim(commentId, cur => {
      if (!cur || cur.item_id !== id) return null
      return { ...cur, reactions: toggleReaction(cur.reactions, emoji, user.id) }
    })
    if (!result.claimed) return NextResponse.json({ error: 'That comment is not on this item' }, { status: 404 })
    return NextResponse.json({ id: commentId, reactions: reactionsOf(result.row.reactions) })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
