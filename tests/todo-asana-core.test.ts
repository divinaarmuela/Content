import { describe, expect, it } from 'vitest'
import {
  activityWords, cleanCommentBody, dueForGroup, idsOf, isOnTodo, mayCommentOnTodo, todoAudience, todoChanges, toggleId, visibleWithFollowers,
} from '../app/lib/todo-core'

describe("todo-core — Asana's My Tasks (18 Oct 2026)", () => {
  const sa = { id: 'boss', role: 'super_admin' }
  const amy = { id: 'amy', role: 'scheduler' }
  const row = { id: 't1', owner_id: 'bob', created_by: 'cat', followers: ['amy'], parent_id: null }

  it('reads id lists safely and toggles one id', () => {
    expect(idsOf(null)).toEqual([])
    expect(idsOf(['a', 'a', '', 'b'])).toEqual(['a', 'b'])
    expect(toggleId(['a'], 'b', true)).toEqual(['a', 'b'])
    expect(toggleId(['a', 'b'], 'a', false)).toEqual(['b'])
    expect(toggleId(['a'], 'a', true)).toEqual(['a'])
  })

  it('a collaborator is on the to-do, sees it and its subtasks, and may comment', () => {
    expect(isOnTodo('amy', row)).toBe(true)
    expect(isOnTodo('dan', row)).toBe(false)
    const sub = { id: 's1', owner_id: 'bob', created_by: 'bob', followers: [], parent_id: 't1' }
    const other = { id: 't2', owner_id: 'dan', created_by: 'dan', followers: [], parent_id: null }
    expect(visibleWithFollowers(amy, [row, sub, other]).map(r => r.id)).toEqual(['t1', 's1'])
    expect(visibleWithFollowers(sa, [row, sub, other])).toHaveLength(3)
    expect(visibleWithFollowers({ id: 'c', role: 'client' }, [row])).toEqual([])
    expect(mayCommentOnTodo(amy, row)).toBe(true)
    expect(mayCommentOnTodo({ id: 'dan', role: 'scheduler' }, row)).toBe(false)
    expect(mayCommentOnTodo({ id: 'dan', role: 'scheduler' }, sub, { ...row, followers: ['dan'] })).toBe(true)
  })

  it('tells the holder, writer and collaborators — never the actor, never a tagged person twice', () => {
    expect(todoAudience(row, 'cat')).toEqual(['bob', 'amy'])
    expect(todoAudience(row, 'cat', ['amy'])).toEqual(['bob'])
    expect(todoAudience({ owner_id: 'bob', created_by: 'bob', followers: ['bob'] }, 'x')).toEqual(['bob'])
  })

  it('cleans a comment', () => {
    expect(cleanCommentBody('  ')).toEqual({ ok: false, reason: 'Write something first' })
    const long = cleanCommentBody('x'.repeat(5000))
    expect(long.ok && long.body.length).toBe(4000)
  })

  it('gives a section its date', () => {
    expect(dueForGroup('today', '2026-10-18')).toBe('2026-10-18')
    expect(dueForGroup('week', '2026-10-18')).toBe('2026-10-19')
    expect(dueForGroup('later', '2026-10-18')).toBe('2026-10-25')
    expect(dueForGroup('undated', '2026-10-18')).toBeNull()
  })

  it('lists what changed and says it in words', () => {
    expect(todoChanges({ title: 'a', due_date: null }, { title: 'a', due_date: '2026-10-20', owner_id: undefined })).toEqual([
      { field: 'due_date', from: null, to: '2026-10-20' },
    ])
    const name = (id: string | null) => (id === 'bob' ? 'Bob' : '?')
    expect(activityWords({ action: 'todo_changed:owner_id', new_value: 'bob' }, name, () => '')).toBe('assigned this task to Bob')
    expect(activityWords({ action: 'todo_changed:due_date', new_value: null }, name, () => '')).toBe('removed the due date')
    expect(activityWords({ action: 'todo_done' }, name, () => '')).toBe('completed this task')
  })
})
