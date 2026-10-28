import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// 29 Oct 2026: Asana's "- Team Operations" had nowhere to go — To-dos' projects were clients only
describe("the agency's own projects", () => {
  it('are listed first, for their members and every super admin', () => {
    const s = readFileSync('app/api/todos/projects/route.ts', 'utf8')
    expect(s).toContain("table<InternalProject>('todo_projects' as never).list()")
    expect(s).toContain("user.role === 'super_admin' || (Array.isArray(p.member_ids) && p.member_ids.includes(user.id))")
    expect(s).toContain('return NextResponse.json({ projects: [...ours, ...projects] })')
  })
  it('count as a member’s own on the page, and a task on one shows its project, not a client picker', () => {
    const page = readFileSync('app/dashboard/todos/page.tsx', 'utf8')
    expect(page).toContain("...projects.filter(p => p.internal && p.mine).map(p => p.id)")
    const panel = readFileSync('app/dashboard/todos/TodoPanel.tsx', 'utf8')
    expect(panel).toContain('internalProjects.some(p => p.id === t.client_id)')
  })
  it('can have sections added, like a client project', () => {
    const s = readFileSync('app/api/todo-project-sections/route.ts', 'utf8')
    expect(s).toContain("table<{ id: string }>('todo_projects' as never).get(clientId)")
  })
  it('the import is silent: straight to the database, never an app route', () => {
    const s = readFileSync('scripts/import-asana-project.mjs', 'utf8')
    expect(s).not.toMatch(/\/api\//)
    expect(s).toContain("const ourId = g => `asana_${g}`")
    expect(s).toContain("if (copied.has(t.gid)) { skipped++; continue }")
  })
})
