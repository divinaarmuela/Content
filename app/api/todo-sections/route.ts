import { NextResponse } from 'next/server'
import { table } from '@/lib/db'
import type { TodoSection } from '@/lib/db-types'
import { authzErrorResponse, requireRole } from '../../lib/authz'

/**
 * A PERSON'S OWN SECTIONS on My to-dos (Asana's "Add section", 18 Oct 2026).
 * POST { name, position? } adds one to the caller's own list. Sections are
 * personal: nobody else's list is changed. The page reads the table live.
 */
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const user = await requireRole('scheduler')   // any team role
    const body = await req.json().catch(() => ({}))
    const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 80) : ''
    if (!name) return NextResponse.json({ error: 'Name the section' }, { status: 400 })
    const position = Number.isFinite(Number(body?.position)) ? Number(body.position) : Date.now()
    const now = new Date().toISOString()
    const row = await table<TodoSection>('todo_sections').insert({ owner_id: user.id, name, position, created_at: now, updated_at: now } as never)
    return NextResponse.json(row, { status: 201 })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
