import { NextResponse } from 'next/server'
import { todoViewerOf } from '../../../../lib/todo-viewer'
import { table } from '@/lib/db'
import type { Todo as TodoRow } from '@/lib/db-types'
import { authzErrorResponse, requireRole } from '../../../../lib/authz'
import { mayCommentOnTodo, toggleId } from '../../../../lib/todo-core'

/** A THUMBS-UP on a to-do (Asana's like, 18 Oct 2026). POST { on }. Inside a claim. */
export const dynamic = 'force-dynamic'
type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: Ctx) {
  try {
    const user = await requireRole('scheduler')   // any team role
    const { id } = await ctx.params
    const on = (await req.json().catch(() => ({})))?.on !== false
    const row = await table<TodoRow>('todos').get(id)
    if (!row) return NextResponse.json({ error: 'That to-do is gone' }, { status: 404 })
    const parent = row.parent_id ? await table<TodoRow>('todos').get(row.parent_id) : null
    if (!mayCommentOnTodo(await todoViewerOf(user), row as never, parent as never)) return NextResponse.json({ error: 'Not your to-do' }, { status: 403 })
    const res = await table<TodoRow>('todos').claim(id, cur => cur ? { ...cur, likes: toggleId(cur.likes, user.id, on) } as TodoRow : null)
    if (!res.claimed) return NextResponse.json({ error: 'That to-do is gone' }, { status: 404 })
    return NextResponse.json(res.row)
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
