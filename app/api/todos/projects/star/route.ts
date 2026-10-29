import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import { requireRole, authzErrorResponse } from '../../../../lib/authz'

/**
 * POST { project_id, on } — STAR A PROJECT, or take the star off (Abby, 29 Oct 2026: "can we add a Star? Like we can
 * favorite the project board so it comes up on top"). A person's own: starred projects sit at the top of their To-dos
 * sidebar, nobody else's. One row per person and project, so a second press is the same row.
 */
export const dynamic = 'force-dynamic'
type Star = { id: string; team_user_id: string; project_id: string; created_at: string }

export async function POST(req: Request) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const body = await req.json().catch(() => ({})) as { project_id?: unknown; on?: unknown }
      const projectId = typeof body.project_id === 'string' ? body.project_id.trim() : ''
      if (!projectId || !/^[A-Za-z0-9_-]{1,80}$/.test(projectId)) return NextResponse.json({ error: 'Which project?' }, { status: 400 })
      const id = `${user.id}__${projectId}`
      const stars = table<Star>('todo_project_stars' as never)
      if (body.on === false) await stars.remove(id).catch(() => undefined)
      else await stars.claim(id, cur => cur ?? { id, team_user_id: user.id, project_id: projectId, created_at: new Date().toISOString() })
      return NextResponse.json({ ok: true, on: body.on !== false })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
