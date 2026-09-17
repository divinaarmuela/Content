import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  dueWords, groupTodos, mayDeleteTodo, mayEditTodo, mayFilterByPerson, sanitiseTodoPatch, sortTodos, todoFilesOf, todoGroupOf, todosEmptyWords, visibleTodos,
} from '../app/lib/todo-core'

const rows = [
  { id: 'a', owner_id: 'am', created_by: 'super', status: 'open', due_date: '2026-09-17', created_at: '1' },
  { id: 'b', owner_id: 'ed', created_by: 'am', status: 'open', due_date: null, created_at: '2' },
  { id: 'c', owner_id: 'sc', created_by: 'sc', status: 'done', due_date: '2026-09-01', created_at: '3', done_at: '9' },
  { id: 'd', owner_id: 'ed', created_by: 'ed', status: 'open', due_date: '2026-09-10', created_at: '4' },
]

describe('todo-core — who sees and changes what (17 Sep 2026)', () => {
  it('a super admin sees all; everyone else what they hold or wrote; a client nothing', () => {
    expect(visibleTodos({ id: 'super', role: 'super_admin' }, rows).map(r => r.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(visibleTodos({ id: 'am', role: 'account_manager' }, rows).map(r => r.id)).toEqual(['a', 'b'])
    expect(visibleTodos({ id: 'ed', role: 'editor' }, rows).map(r => r.id)).toEqual(['b', 'd'])
    expect(visibleTodos({ id: 'sc', role: 'scheduler' }, rows).map(r => r.id)).toEqual(['c'])
    expect(visibleTodos({ id: 'x', role: 'client' }, rows)).toEqual([])
    expect(visibleTodos(null, rows)).toEqual([])
  })
  it('the person filter is a manager’s; editing is the holder’s or the writer’s; deleting the writer’s or a super admin’s', () => {
    expect(mayFilterByPerson({ id: 'x', role: 'super_admin' })).toBe(true)
    expect(mayFilterByPerson({ id: 'x', role: 'account_manager' })).toBe(true)
    expect(mayFilterByPerson({ id: 'x', role: 'editor' })).toBe(false)
    expect(mayEditTodo({ id: 'ed', role: 'editor' }, rows[1])).toBe(true)
    expect(mayEditTodo({ id: 'am', role: 'account_manager' }, rows[1])).toBe(true)
    expect(mayEditTodo({ id: 'sc', role: 'scheduler' }, rows[1])).toBe(false)
    expect(mayEditTodo({ id: 'super', role: 'super_admin' }, rows[1])).toBe(true)
    expect(mayDeleteTodo({ id: 'ed', role: 'editor' }, rows[1])).toBe(false)
    expect(mayDeleteTodo({ id: 'am', role: 'account_manager' }, rows[1])).toBe(true)
    expect(mayDeleteTodo({ id: 'super', role: 'super_admin' }, rows[1])).toBe(true)
  })
  it('a patch is cleaned and refused with a reason', () => {
    expect(sanitiseTodoPatch({ title: '  Send captions ', note: '', status: 'done', due_date: '2026-09-20', owner_id: ' u1 ', client_id: '', files: [{ url: 'https://m/a.png', name: 'a.png', mime: 'image/png', size: 5 }, { url: 'nope', name: 'x' }], junk: 1 }))
      .toEqual({ ok: true, patch: { title: 'Send captions', note: null, status: 'done', due_date: '2026-09-20', owner_id: 'u1', client_id: null, files: [{ url: 'https://m/a.png', name: 'a.png', mime: 'image/png', size: 5 }] } })
    expect(sanitiseTodoPatch({ title: '   ' })).toEqual({ ok: false, reason: 'Say what the to-do is' })
    expect(sanitiseTodoPatch({ status: 'maybe' })).toEqual({ ok: false, reason: 'A to-do is open or done' })
    expect(sanitiseTodoPatch({ due_date: 'tomorrow' })).toEqual({ ok: false, reason: 'The date is not a date' })
    expect(sanitiseTodoPatch({})).toEqual({ ok: true, patch: {} })
    expect(todoFilesOf('x')).toEqual([])
  })
  it('sorted open-first and dated-first; grouped by when it is due', () => {
    expect(sortTodos(rows).map(r => r.id)).toEqual(['d', 'a', 'b', 'c'])
    expect(todoGroupOf({ status: 'open', due_date: '2026-09-10' }, '2026-09-17')).toBe('overdue')
    expect(todoGroupOf({ status: 'open', due_date: '2026-09-17' }, '2026-09-17')).toBe('today')
    expect(todoGroupOf({ status: 'open', due_date: '2026-09-23' }, '2026-09-17')).toBe('week')
    expect(todoGroupOf({ status: 'open', due_date: '2026-09-24' }, '2026-09-17')).toBe('later')
    expect(todoGroupOf({ status: 'open', due_date: null }, '2026-09-17')).toBe('undated')
    expect(todoGroupOf({ status: 'done', due_date: '2026-09-17' }, '2026-09-17')).toBe('done')
    expect(groupTodos(rows, '2026-09-17').map(g => `${g.key}:${g.rows.map(r => r.id).join('')}`)).toEqual(['overdue:d', 'today:a', 'week:', 'later:', 'undated:b', 'done:c'])
    expect(dueWords('2026-09-17', '2026-09-17')).toBe('Due today')
    expect(dueWords('2026-09-10', '2026-09-17')).toBe('Overdue · 09/10')
    expect(dueWords('2026-10-02', '2026-09-17')).toBe('Due 2 Oct')
    expect(dueWords('2027-01-05', '2026-09-17')).toBe('Due 5 Jan 2027')
    expect(dueWords(null, '2026-09-17')).toBeNull()
    expect(todosEmptyWords({ status: 'open', person: 'p', client: null }, 'Cath')).toBe('Nothing to do for Cath — add one.')
    expect(todosEmptyWords({ status: 'done', person: null, client: null }, null)).toBe('Nothing done yet.')
  })
  it('the page, the routes and the nav carry it', () => {
    const page = readFileSync('app/dashboard/todos/page.tsx', 'utf8')
    expect(page).toContain("useTable<TodoRow>('todos')")
    expect(page).toContain('visibleTodos(viewer, raw as never[])')
    expect(page).toContain('{canFilterPeople && (')
    expect(page).toContain("uploadFiles(picked, { purpose: 'social' })")
    expect(page).toContain('<UploadRows uploads={uploading} compact />')
    for (const f of ['app/api/todos/route.ts', 'app/api/todos/[id]/route.ts']) {
      const s = readFileSync(f, 'utf8')
      expect(s).toContain("requireRole('scheduler')   // any team role")
    }
    expect(readFileSync('app/api/todos/[id]/route.ts', 'utf8')).toContain('if (!mayEditTodo({ id: user.id, role: user.role }, row as never))')
    const middleware = readFileSync('middleware.ts', 'utf8')
    expect(middleware).toContain("'/api/todos(.*)'")
    expect(middleware).toContain("'/api/todos/:path*'")
    const access = readFileSync('app/lib/page-access-core.ts', 'utf8')
    expect(access).toContain("'/dashboard/todos'")
    const shell = readFileSync('app/dashboard/ui/Shell.tsx', 'utf8')
    expect(shell).toContain("{ href: '/dashboard/todos',")
  })
})
