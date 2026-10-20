import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Todo, TodoProjectSection } from '@/lib/db-types'
import { authzErrorResponse, requireRole } from '../../../lib/authz'

/** Rename or move a project's section, or remove it — its tasks stay on the project, in no section. */
type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: Request, ctx: Ctx) {
  return withRequestCache(async () => {
    try {
      await requireRole('scheduler')
      const { id } = await ctx.params
      const body = await req.json().catch(() => ({})) as Record<string, unknown>
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if ('name' in body) { const n = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : ''; if (!n) return NextResponse.json({ error: 'Name the section' }, { status: 400 }); patch.name = n }
      if ('position' in body && Number.isFinite(Number(body.position))) patch.position = Number(body.position)
      if (!(await table<TodoProjectSection>('todo_project_sections').get(id))) return NextResponse.json({ error: 'That section is gone' }, { status: 404 })
      return NextResponse.json(await table<TodoProjectSection>('todo_project_sections').update(id, patch as never))
    } catch (e) { const { error, status } = authzErrorResponse(e); return NextResponse.json({ error }, { status }) }
  })
}

export async function DELETE(_req: Request, ctx: Ctx) {
  return withRequestCache(async () => {
    try {
      await requireRole('scheduler')
      const { id } = await ctx.params
      const inIt = await table<Todo>('todos').list({ where: r => r.project_section_id === id })
      await Promise.all(inIt.map(t => table<Todo>('todos').update(t.id, { project_section_id: null } as never)))
      await table<TodoProjectSection>('todo_project_sections').remove(id)
      return NextResponse.json({ ok: true, moved: inIt.length })
    } catch (e) { const { error, status } = authzErrorResponse(e); return NextResponse.json({ error }, { status }) }
  })
}
