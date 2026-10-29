import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// Abby, 29 Oct 2026: "can we add a Star? Like we can favorite the project board so it comes up on Top view?"
describe('starred projects', () => {
  it('are a person’s own, one row per person and project', () => {
    const r = readFileSync('app/api/todos/projects/star/route.ts', 'utf8')
    expect(r).toContain('const id = `${user.id}__${projectId}`')
    expect(r).toContain("if (body.on === false) await stars.remove(id)")
  })
  it('sit first in the sidebar under Starred, with a star on every project and beside the project’s name', () => {
    const nav = readFileSync('app/dashboard/todos/TodoNav.tsx', 'utf8')
    expect(nav).toContain('<Star className="h-3.5 w-3.5" aria-hidden /> Starred</p>')
    expect(nav).toContain("aria-label={on ? `Take the star off ${p.name}` : `Star ${p.name}`}")
    const page = readFileSync('app/dashboard/todos/page.tsx', 'utf8')
    expect(page).toContain("useTable<{ id: string; team_user_id: string; project_id: string }>('todo_project_stars' as never, { by: starBy as never, enabled: !!me?.id })")
    expect(page).toContain('onClick={() => star(project.id, !starred.has(project.id))}')
  })
})
