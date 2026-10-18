import { NextResponse } from 'next/server'
import { table } from '@/lib/db'
import type { Todo as TodoRow, TodoSection } from '@/lib/db-types'
import { authzErrorResponse, requireRole } from '../../../lib/authz'

/** One of the caller's own sections: PATCH { name?, position? } renames or moves it; DELETE removes it and its to-dos fall back to "Recently assigned". */
export const dynamic = 'force-dynamic'
type Ctx = { params: Promise<{ id: string }> }

async function own(id: string, userId: string) {
  const row = await table<TodoSection>('todo_sections').get(id)
  if (!row) return { error: NextResponse.json({ error: 'That section is gone' }, { status: 404 }) }
  if (row.owner_id !== userId) return { error: NextResponse.json({ error: 'Not your section' }, { status: 403 }) }
  return { row }
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const user = await requireRole('scheduler')   // any team role
    const { id } = await ctx.params
    const found = await own(id, user.id)
    if (found.error) return found.error
    const body = await req.json().catch(() => ({}))
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if ('name' in body) {
      const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : ''
      if (!name) return NextResponse.json({ error: 'Name the section' }, { status: 400 })
      patch.name = name
    }
    if ('position' in body && Number.isFinite(Number(body.position))) patch.position = Number(body.position)
    return NextResponse.json(await table<TodoSection>('todo_sections').update(id, patch as never))
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const user = await requireRole('scheduler')   // any team role
    const { id } = await ctx.params
    const found = await own(id, user.id)
    if (found.error) return found.error
    await table<TodoSection>('todo_sections').remove(id)
    const inIt = await table<TodoRow>('todos').list({ where: t => t.section_id === id })
    await Promise.all(inIt.map(t => table<TodoRow>('todos').update(t.id, { section_id: null } as never)))
    return NextResponse.json({ ok: true })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
