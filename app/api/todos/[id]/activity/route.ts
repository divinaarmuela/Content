import { NextResponse } from 'next/server'
import { todoViewerOf } from '../../../../lib/todo-viewer'
import { table } from '@/lib/db'
import type { Todo as TodoRow } from '@/lib/db-types'
import { authzErrorResponse, requireRole } from '../../../../lib/authz'
import { mayCommentOnTodo } from '../../../../lib/todo-core'

/** THE ACTIVITY FEED of one to-do (Asana's "All activity", 18 Oct 2026): its workflow_activity rows, oldest first. */
export const dynamic = 'force-dynamic'
type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const user = await requireRole('scheduler')   // any team role
    const { id } = await ctx.params
    const row = await table<TodoRow>('todos').get(id)
    if (!row) return NextResponse.json({ error: 'That to-do is gone' }, { status: 404 })
    const parent = row.parent_id ? await table<TodoRow>('todos').get(row.parent_id) : null
    if (!mayCommentOnTodo(await todoViewerOf(user), row as never, parent as never)) return NextResponse.json({ error: 'Not your to-do' }, { status: 403 })
    const rows = await table('workflow_activity').list({ where: r => r.entity_type === 'todo' && r.entity_id === id })
    const activity = (rows as Record<string, unknown>[])
      .map(r => ({ id: r.id, created_at: r.created_at, actor_id: r.actor_id ?? null, action: r.action, old_value: r.old_value ?? null, new_value: r.new_value ?? null, detail: r.detail ?? null }))
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    return NextResponse.json({ activity })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
