import { NextResponse, after } from 'next/server'
import { table } from '@/lib/db'
import type { Todo as TodoRow, TodoComment } from '@/lib/db-types'
import { authzErrorResponse, requireRole } from '../../../../lib/authz'
import { cleanCommentBody, mayCommentOnTodo, toggleId, todoAudience } from '../../../../lib/todo-core'
import { resolveTags, taggableTeam } from '../../../../lib/comment-tags'
import { notifyTodo } from '../../../../lib/todo-notify'

/**
 * A COMMENT ON A TO-DO (Asana's comment box, 18 Oct 2026). POST { body, mention_ids }.
 * "@Name" in the text tags a person: they become a collaborator and are told
 * "tagged you on". Everyone else on the to-do (holder, writer, collaborators)
 * is told "commented on". The writer joins as a collaborator, as in Asana.
 */
export const dynamic = 'force-dynamic'
type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: Ctx) {
  try {
    const user = await requireRole('scheduler')   // any team role
    const { id } = await ctx.params
    const body = await req.json().catch(() => ({}))
    const clean = cleanCommentBody(body?.body)
    if (!clean.ok) return NextResponse.json({ error: clean.reason }, { status: 400 })
    const row = await table<TodoRow>('todos').get(id)
    if (!row) return NextResponse.json({ error: 'That to-do is gone' }, { status: 404 })
    const parent = row.parent_id ? await table<TodoRow>('todos').get(row.parent_id) : null
    if (!mayCommentOnTodo({ id: user.id, role: user.role }, row as never, parent as never)) return NextResponse.json({ error: 'Not your to-do' }, { status: 403 })
    const team = await taggableTeam()
    const tagged = resolveTags(clean.body, Array.isArray(body?.mention_ids) ? body.mention_ids.map(String) : [], team, user.id)
    const now = new Date().toISOString()
    const comment = await table<TodoComment>('todo_comments').insert({
      todo_id: id, author_id: user.id, body: clean.body, mentions: tagged.map(t => t.id), likes: [], created_at: now, updated_at: now,
    } as never)
    // the writer and everyone tagged join the to-do, so a tagged person can open it
    const joining = [user.id, ...tagged.map(t => t.id)]
    const res = await table<TodoRow>('todos').claim(id, cur => {
      if (!cur) return null
      let followers: unknown = cur.followers
      for (const p of joining) if (p !== cur.owner_id && p !== cur.created_by) followers = toggleId(followers, p, true)
      return { ...cur, followers } as TodoRow
    })
    const latest = res.claimed ? res.row : row
    const taggedIds = tagged.map(t => t.id)
    after(() => notifyTodo({ actor: user, todo: row as never, recipientIds: taggedIds, verb: 'tagged you on', event: 'todo_tagged', eventKey: `c:${comment.id}`, quote: clean.body }).catch(e => console.error('[todos] notify failed:', e)))
    after(() => notifyTodo({ actor: user, todo: row as never, recipientIds: todoAudience(latest as never, user.id, taggedIds), verb: 'commented on', event: 'todo_comment', eventKey: `c:${comment.id}`, quote: clean.body }).catch(e => console.error('[todos] notify failed:', e)))
    return NextResponse.json(comment, { status: 201 })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
