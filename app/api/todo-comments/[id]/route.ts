import { NextResponse } from 'next/server'
import { table } from '@/lib/db'
import type { TodoComment } from '@/lib/db-types'
import { authzErrorResponse, requireRole } from '../../../lib/authz'
import { cleanCommentBody } from '../../../lib/todo-core'

/** One comment on a to-do: its writer edits it (PATCH { body }) or deletes it; a super admin may delete any. */
export const dynamic = 'force-dynamic'
type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const user = await requireRole('scheduler')   // any team role
    const { id } = await ctx.params
    const row = await table<TodoComment>('todo_comments').get(id)
    if (!row) return NextResponse.json({ error: 'That comment is gone' }, { status: 404 })
    if (row.author_id !== user.id) return NextResponse.json({ error: 'Only its writer can change it' }, { status: 403 })
    const clean = cleanCommentBody((await req.json().catch(() => ({})))?.body)
    if (!clean.ok) return NextResponse.json({ error: clean.reason }, { status: 400 })
    return NextResponse.json(await table<TodoComment>('todo_comments').update(id, { body: clean.body, edited_at: new Date().toISOString(), updated_at: new Date().toISOString() } as never))
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const user = await requireRole('scheduler')   // any team role
    const { id } = await ctx.params
    const row = await table<TodoComment>('todo_comments').get(id)
    if (!row) return NextResponse.json({ ok: true })
    if (row.author_id !== user.id && user.role !== 'super_admin') return NextResponse.json({ error: 'Only its writer can delete it' }, { status: 403 })
    await table<TodoComment>('todo_comments').remove(id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
