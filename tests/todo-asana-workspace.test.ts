import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { inTodoProject, mayCommentOnTodo, visibleWithFollowers } from '../app/lib/todo-core'
import { agoWords, inboxDay, inboxFor, inboxItemOf, projectColour } from '../app/lib/todo-inbox-core'

const src = (p: string) => readFileSync(p, 'utf8')

describe("To-dos as Asana's — Inbox, My tasks, Projects (Manal's video, 20 Oct 2026)", () => {
  const manal = { id: 'manal', role: 'account_manager', clientIds: ['stretch'] }
  const daniela = { id: 't1', owner_id: 'daniela', created_by: 'daniela', client_id: 'stretch' }
  const other = { id: 't2', owner_id: 'daniela', created_by: 'daniela', client_id: 'releeph' }

  it("a client's project shows everyone's tasks for it to those on the client — and lets them comment", () => {
    expect(inTodoProject(manal, daniela)).toBe(true)
    expect(visibleWithFollowers(manal, [daniela, other]).map(t => t.id)).toEqual(['t1'])
    expect(mayCommentOnTodo(manal, daniela)).toBe(true)
    expect(mayCommentOnTodo(manal, other)).toBe(false)
    // without the client list, as before: only what you are on
    expect(visibleWithFollowers({ id: 'manal', role: 'account_manager' }, [daniela])).toEqual([])
  })

  it('every route checks with the clients the person is on', () => {
    for (const p of ['app/api/todos/route.ts', 'app/api/todos/[id]/comments/route.ts', 'app/api/todos/[id]/activity/route.ts', 'app/api/todos/[id]/follow/route.ts', 'app/api/todos/[id]/like/route.ts', 'app/api/todo-comments/[id]/like/route.ts']) {
      expect(src(p)).toContain('await todoViewerOf(user)')
    }
  })

  it('the inbox reads the notification: its task, its words, read or not; @Mentioned is the tags', () => {
    const i = inboxItemOf({ id: 'n1', event_type: 'todo_tagged', subject: 'Raven tagged you on Trend Spotting', entity_type: 'todo', entity_id: 'todo9#c:abc', body_html: '<p>x</p><blockquote style="a">please &amp; approve</blockquote>', created_at: '2026-10-20T03:00:00Z', read_at: null, recipient_id: 'manal' })
    expect(i).toMatchObject({ todoId: 'todo9', quote: 'please & approve', read: false })
    const done = { ...i, id: 'n2', event: 'todo_done' }
    expect(inboxFor([i, done], 'mentioned').map(x => x.id)).toEqual(['n1'])
    expect(inboxFor([i, done], 'activity')).toHaveLength(2)
    expect(inboxDay('2026-10-20T03:00:00Z', '2026-10-20')).toBe('Today')
    expect(inboxDay('2026-10-19T03:00:00Z', '2026-10-20')).toBe('Yesterday')
    expect(agoWords('2026-10-20T00:00:00Z', Date.parse('2026-10-20T04:00:00Z'))).toBe('4 hours ago')
  })

  it("a project's colour is its brand's, or the same one of Asana's every time", () => {
    expect(projectColour('x', '#49090A')).toBe('#49090A')
    expect(projectColour('abc')).toBe(projectColour('abc'))
  })

  it('the page opens on My tasks, has the sidebar and the inbox; a tag in the description notifies', () => {
    const page = src('app/dashboard/todos/page.tsx')
    expect(page).toContain("useState<Place>('mine')")
    expect(page).toContain('<TodoSidebar')
    expect(page).toContain('<TodoInbox')
    expect(page).toContain("place === 'mine' ? t.owner_id === me?.id")
    const patch = src('app/api/todos/[id]/route.ts')
    expect(patch).toContain("verb: 'mentioned you in', event: 'todo_mentioned'")
  })
})
