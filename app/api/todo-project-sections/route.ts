import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Client, TodoProjectSection } from '@/lib/db-types'
import { authzErrorResponse, requireRole } from '../../lib/authz'

/**
 * A CLIENT PROJECT'S SECTIONS (the owner, 20 Oct 2026: Asana's project columns — "Core Deliverables", "Editing Queu",
 * "Done" …). POST { client_id, name, position? } adds one. Anyone on the team, as in Asana a project member adds one.
 */
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  return withRequestCache(async () => {
    try {
      await requireRole('scheduler')
      const body = await req.json().catch(() => ({})) as Record<string, unknown>
      const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : ''
      const clientId = typeof body.client_id === 'string' ? body.client_id : ''
      if (!name) return NextResponse.json({ error: 'Name the section' }, { status: 400 })
      if (!clientId || !(await table<Client>('clients').get(clientId))) return NextResponse.json({ error: 'Which client\'s project?' }, { status: 400 })
      const now = new Date().toISOString()
      const position = Number.isFinite(Number(body.position)) ? Number(body.position) : Date.now()
      const row = await table<TodoProjectSection>('todo_project_sections').insert({ client_id: clientId, name, position, created_at: now, updated_at: now } as never)
      return NextResponse.json(row, { status: 201 })
    } catch (e) { const { error, status } = authzErrorResponse(e); return NextResponse.json({ error }, { status }) }
  })
}
