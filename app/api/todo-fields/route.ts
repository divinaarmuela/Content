import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { TodoField } from '@/lib/db-types'
import { authzErrorResponse, requireRole } from '../../lib/authz'
import { sanitiseFieldDef } from '../../lib/todo-fields-core'

/**
 * TO-DO CUSTOM FIELDS (the owner, 20 Oct 2026: Asana's custom columns, "add this as a feature"). GET: every field, for
 * anyone on the team. POST { name, type, options? }: a new one — an account manager's or a super admin's, as in Asana a
 * field is added to the whole workspace. The page reads the table live.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  return withRequestCache(async () => {
    try {
      await requireRole('scheduler')
      return NextResponse.json({ fields: await table<TodoField>('todo_fields').list() })
    } catch (e) { const { error, status } = authzErrorResponse(e); return NextResponse.json({ error }, { status }) }
  })
}

export async function POST(req: Request) {
  return withRequestCache(async () => {
    try {
      await requireRole('account_manager')
      const checked = sanitiseFieldDef(await req.json().catch(() => ({})))
      if (!checked.ok) return NextResponse.json({ error: checked.reason }, { status: 400 })
      const now = new Date().toISOString()
      const row = await table<TodoField>('todo_fields').insert({ ...checked.def, position: checked.def.position ?? Date.now(), created_at: now, updated_at: now } as never)
      return NextResponse.json(row, { status: 201 })
    } catch (e) { const { error, status } = authzErrorResponse(e); return NextResponse.json({ error }, { status }) }
  })
}
