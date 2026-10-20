import { NextResponse, after } from 'next/server'
import { todoViewerOf } from '../../../../lib/todo-viewer'
import { table } from '@/lib/db'
import type { Todo as TodoRow } from '@/lib/db-types'
import { authzErrorResponse, requireRole } from '../../../../lib/authz'
import { logActivity } from '../../../../lib/workflow'
import { mayCommentOnTodo, toggleId } from '../../../../lib/todo-core'
import { notifyTodo } from '../../../../lib/todo-notify'

/**
 * COLLABORATORS (Asana's followers, 18 Oct 2026). POST { on, person_id? }:
 * join or leave a to-do yourself, or add somebody else to it. Anyone on the
 * to-do may add a collaborator; only you may take yourself off (or a super
 * admin). The list is changed inside a claim, so two presses never lose one.
 */
export const dynamic = 'force-dynamic'
type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: Ctx) {
  try {
    const user = await requireRole('scheduler')   // any team role
    const { id } = await ctx.params
    const body = await req.json().catch(() => ({}))
    const on = body?.on !== false
    const personId = typeof body?.person_id === 'string' && body.person_id ? body.person_id : user.id
    const row = await table<TodoRow>('todos').get(id)
    if (!row) return NextResponse.json({ error: 'That to-do is gone' }, { status: 404 })
    const parent = row.parent_id ? await table<TodoRow>('todos').get(row.parent_id) : null
    if (!mayCommentOnTodo(await todoViewerOf(user), row as never, parent as never)) return NextResponse.json({ error: 'Not your to-do' }, { status: 403 })
    if (!on && personId !== user.id && user.role !== 'super_admin') return NextResponse.json({ error: 'Only they can leave it' }, { status: 403 })
    const res = await table<TodoRow>('todos').claim(id, cur => cur ? { ...cur, followers: toggleId(cur.followers, personId, on) } as TodoRow : null)
    if (!res.claimed) return NextResponse.json({ error: 'That to-do is gone' }, { status: 404 })
    if (on) {
      await logActivity({ entityType: 'todo', entityId: id, action: 'todo_followed', actor: user, newValue: personId, detail: String(row.title ?? '').slice(0, 200) })
      if (personId !== user.id) {
        after(() => notifyTodo({ actor: user, todo: row as never, recipientIds: [personId], verb: 'added you as a collaborator on', event: 'todo_followed', eventKey: `follow:${personId}` }).catch(e => console.error('[todos] notify failed:', e)))
      }
    }
    return NextResponse.json(res.row)
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
