import { NextResponse } from 'next/server'
import { table } from '@/lib/db'
import type { Todo as TodoRow } from '@/lib/db-types'
import { authzErrorResponse, requireRole } from '../../lib/authz'
import { logActivity } from '../../lib/workflow'
import { sanitiseTodoPatch, visibleTodos } from '../../lib/todo-core'

/**
 * TO-DOS (todo-core): GET the rows the caller may see, POST a new one. Any
 * team role — the rules of who sees and edits what are in the core, and
 * the page reads the table live and applies the same rules; this GET is
 * for the assistant and for anything that is not a browser.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const user = await requireRole('scheduler')   // any team role
    const rows = await table<TodoRow>('todos').list()
    return NextResponse.json({ todos: visibleTodos({ id: user.id, role: user.role }, rows as never) })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireRole('scheduler')   // any team role
    const body = await req.json().catch(() => ({}))
    const checked = sanitiseTodoPatch({ title: '', ...body })
    if (!checked.ok) return NextResponse.json({ error: checked.reason }, { status: 400 })
    const now = new Date().toISOString()
    const row = await table<TodoRow>('todos').insert({
      title: checked.patch.title ?? '',
      note: checked.patch.note ?? null,
      status: 'open',
      due_date: checked.patch.due_date ?? null,
      // for me unless somebody else is named
      owner_id: checked.patch.owner_id ?? user.id,
      created_by: user.id,
      client_id: checked.patch.client_id ?? null,
      files: checked.patch.files ?? [],
      created_at: now,
      updated_at: now,
      done_at: null,
      done_by: null,
    } as never)
    await logActivity({ entityType: 'todo', entityId: row.id, action: 'todo_made', actor: user, detail: (checked.patch.title ?? '').slice(0, 200) })
    return NextResponse.json(row, { status: 201 })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
