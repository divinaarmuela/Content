import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { TodoField } from '@/lib/db-types'
import { authzErrorResponse, requireRole } from '../../../lib/authz'
import { sanitiseFieldDef } from '../../../lib/todo-fields-core'

/** Change a field (its name, its options and their colours) or remove it — an account manager's or a super admin's.
 *  Removing a field leaves the tasks' old values where they were, unread; nothing else is touched. */
type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: Request, ctx: Ctx) {
  return withRequestCache(async () => {
    try {
      await requireRole('account_manager')
      const { id } = await ctx.params
      const cur = await table<TodoField>('todo_fields').get(id)
      if (!cur) return NextResponse.json({ error: 'That field is gone' }, { status: 404 })
      const body = await req.json().catch(() => ({})) as Record<string, unknown>
      const checked = sanitiseFieldDef({ name: cur.name, type: cur.type, options: cur.options, position: cur.position, ...body })
      if (!checked.ok) return NextResponse.json({ error: checked.reason }, { status: 400 })
      const row = await table<TodoField>('todo_fields').update(id, { ...checked.def, updated_at: new Date().toISOString() } as never)
      return NextResponse.json(row)
    } catch (e) { const { error, status } = authzErrorResponse(e); return NextResponse.json({ error }, { status }) }
  })
}

export async function DELETE(_req: Request, ctx: Ctx) {
  return withRequestCache(async () => {
    try {
      await requireRole('account_manager')
      const { id } = await ctx.params
      await table<TodoField>('todo_fields').remove(id)
      return NextResponse.json({ ok: true })
    } catch (e) { const { error, status } = authzErrorResponse(e); return NextResponse.json({ error }, { status }) }
  })
}
