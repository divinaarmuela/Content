import { NextResponse } from 'next/server'
import { table } from '@/lib/db'
import type { Todo as TodoRow } from '@/lib/db-types'
import { authzErrorResponse, requireRole } from '../../../lib/authz'
import { logActivity } from '../../../lib/workflow'
import { mayDeleteTodo, mayEditTodo, sanitiseTodoPatch } from '../../../lib/todo-core'

/** One to-do: PATCH what changed (title, note, status, date, who, client, files), DELETE it. */
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const user = await requireRole('scheduler')   // any team role
    const { id } = await ctx.params
    const row = await table<TodoRow>('todos').get(id)
    if (!row) return NextResponse.json({ error: 'That to-do is gone' }, { status: 404 })
    if (!mayEditTodo({ id: user.id, role: user.role }, row as never)) return NextResponse.json({ error: 'Not your to-do' }, { status: 403 })
    const checked = sanitiseTodoPatch(await req.json().catch(() => ({})))
    if (!checked.ok) return NextResponse.json({ error: checked.reason }, { status: 400 })
    const now = new Date().toISOString()
    const patch: Record<string, unknown> = { ...checked.patch, updated_at: now }
    // ticking it done stamps who and when; reopening clears them
    if (checked.patch.status === 'done' && row.status !== 'done') { patch.done_at = now; patch.done_by = user.id }
    if (checked.patch.status === 'open') { patch.done_at = null; patch.done_by = null }
    const updated = await table<TodoRow>('todos').update(id, patch as never)
    if (checked.patch.status && checked.patch.status !== row.status) {
      await logActivity({ entityType: 'todo', entityId: id, action: checked.patch.status === 'done' ? 'todo_done' : 'todo_reopened', actor: user, detail: String(row.title ?? '').slice(0, 200) })
    }
    return NextResponse.json(updated)
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const user = await requireRole('scheduler')   // any team role
    const { id } = await ctx.params
    const row = await table<TodoRow>('todos').get(id)
    if (!row) return NextResponse.json({ ok: true })
    if (!mayDeleteTodo({ id: user.id, role: user.role }, row as never)) return NextResponse.json({ error: 'Only the person who made it, or a super admin, can delete it' }, { status: 403 })
    await table<TodoRow>('todos').remove(id)
    await logActivity({ entityType: 'todo', entityId: id, action: 'todo_deleted', actor: user, detail: String(row.title ?? '').slice(0, 200) })
    return NextResponse.json({ ok: true })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
