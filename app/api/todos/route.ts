import { NextResponse, after } from 'next/server'
import { table } from '@/lib/db'
import type { Todo as TodoRow } from '@/lib/db-types'
import { authzErrorResponse, requireRole } from '../../lib/authz'
import { logActivity } from '../../lib/workflow'
import { mayCommentOnTodo, sanitiseTodoPatch, visibleWithFollowers } from '../../lib/todo-core'
import { notifyTodo } from '../../lib/todo-notify'

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
    return NextResponse.json({ todos: visibleWithFollowers({ id: user.id, role: user.role }, rows as never) })
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
    // A SUBTASK (18 Oct 2026): made under a to-do the person is on; it takes the parent's client
    const parentId = typeof body?.parent_id === 'string' && body.parent_id.trim() ? body.parent_id.trim() : null
    const parent = parentId ? await table<TodoRow>('todos').get(parentId) : null
    if (parentId && (!parent || parent.parent_id)) return NextResponse.json({ error: 'That to-do is gone' }, { status: 404 })
    if (parent && !mayCommentOnTodo({ id: user.id, role: user.role }, parent as never)) return NextResponse.json({ error: 'Not your to-do' }, { status: 403 })
    const now = new Date().toISOString()
    const row = await table<TodoRow>('todos').insert({
      parent_id: parent?.id ?? null,
      followers: [],
      likes: [],
      title: checked.patch.title ?? '',
      note: checked.patch.note ?? null,
      status: 'open',
      due_date: checked.patch.due_date ?? null,
      // for me unless somebody else is named
      owner_id: checked.patch.owner_id ?? user.id,
      created_by: user.id,
      client_id: checked.patch.client_id ?? parent?.client_id ?? null,
      files: checked.patch.files ?? [],
      section_id: checked.patch.section_id ?? null,
      position: checked.patch.position ?? Date.now(),
      blocked_by: [],
      // Asana's "Repeats", set as it is made (20 Oct 2026)
      repeat: checked.patch.repeat ?? null,
      created_at: now,
      updated_at: now,
      done_at: null,
      done_by: null,
    } as never)
    await logActivity({ entityType: 'todo', entityId: row.id, action: 'todo_made', actor: user, detail: (checked.patch.title ?? '').slice(0, 200) })
    if (parent) await logActivity({ entityType: 'todo', entityId: parent.id, action: 'todo_subtask', actor: user, detail: (checked.patch.title ?? '').slice(0, 200) })
    // handed to somebody else: they are told (bell + email), like Asana's "assigned you"
    if (row.owner_id && row.owner_id !== user.id) {
      after(() => notifyTodo({ actor: user, todo: row as never, recipientIds: [row.owner_id as string], verb: 'assigned you', event: 'todo_assigned', eventKey: `assigned:${row.owner_id}:${now}` }).catch(e => console.error('[todos] notify failed:', e)))
    }
    return NextResponse.json(row, { status: 201 })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
