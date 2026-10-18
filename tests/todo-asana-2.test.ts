import { describe, expect, it } from 'vitest'
import { groupTodosBy, mayDependOn, openBlockers, parseNote, positionBetween, sanitiseTodoPatch, sortTodosBy } from '../app/lib/todo-core'

const rows = [
  { id: 'a', title: 'Zed', status: 'open', due_date: '2026-10-20', created_at: '1', owner_id: 'u2', position: 3, section_id: 's1', client_id: null },
  { id: 'b', title: 'alpha', status: 'open', due_date: null, created_at: '2', owner_id: 'u1', position: 1, section_id: null, client_id: 'c1' },
  { id: 'c', title: 'Mid', status: 'done', due_date: '2026-10-01', created_at: '3', owner_id: 'u1', position: 2, section_id: 's1', client_id: 'c1' },
]
const nameOf = (id: string | null) => ({ u1: 'Amy', u2: 'Bob' } as Record<string, string>)[id ?? ''] ?? ''

describe('todo-core — sort, group, sections, dependencies, notes (18 Oct 2026)', () => {
  it('sorts the chosen way, open before done', () => {
    expect(sortTodosBy(rows, 'alpha').map(r => r.id)).toEqual(['b', 'a', 'c'])
    expect(sortTodosBy(rows, 'manual').map(r => r.id)).toEqual(['b', 'a', 'c'])
    expect(sortTodosBy(rows, 'assignee', nameOf).map(r => r.id)).toEqual(['b', 'a', 'c'])
  })
  it('groups by my sections, with the unfiled first', () => {
    const g = groupTodosBy(rows, 'sections', { today: '2026-10-18', sort: 'manual', sections: [{ id: 's1', name: 'Doing' }], nameOf, clientOf: () => '' })
    expect(g.map(x => [x.label, x.rows.map(r => r.id)])).toEqual([['Recently assigned', ['b']], ['Doing', ['a', 'c']]])
  })
  it('groups by assignee and by client, the empty bucket last', () => {
    const g = groupTodosBy(rows, 'client', { today: '2026-10-18', sort: 'due', sections: [], nameOf, clientOf: () => 'Capila' })
    expect(g.map(x => x.label)).toEqual(['Capila', 'No client'])
    expect(groupTodosBy(rows, 'none', { today: '2026-10-18', sort: 'due', sections: [], nameOf, clientOf: () => '' })[0].rows).toHaveLength(3)
  })
  it('places a dropped row between its neighbours', () => {
    expect(positionBetween(1, 3)).toBe(2)
    expect(positionBetween(null, 10)).toBe(10 - 1024)
    expect(positionBetween(10, null)).toBe(10 + 1024)
  })
  it('never lets a dependency loop, and counts only open blockers', () => {
    const all = [{ id: 'x', blocked_by: ['y'] }, { id: 'y', blocked_by: [] }, { id: 'z', blocked_by: ['x'] }]
    expect(mayDependOn('y', 'x', all)).toBe(false)
    expect(mayDependOn('y', 'z', all)).toBe(false)
    expect(mayDependOn('x', 'x', all)).toBe(false)
    expect(mayDependOn('z', 'y', all)).toBe(true)
    expect(openBlockers({ blocked_by: ['a', 'c', 'gone'] }, rows).map(r => r.id)).toEqual(['a'])
  })
  it('cleans the new fields', () => {
    expect(sanitiseTodoPatch({ position: 'x' })).toEqual({ ok: false, reason: 'The order is not a number' })
    expect(sanitiseTodoPatch({ section_id: ' ', blocked_by: ['a', 'a', ''] })).toEqual({ ok: true, patch: { section_id: null, blocked_by: ['a'] } })
  })
  it('reads the description formatting as text, not HTML', () => {
    expect(parseNote('Hi **you** and *me*\n- one\n- two\n1. first')).toEqual([
      { kind: 'p', spans: [{ text: 'Hi ' }, { text: 'you', bold: true }, { text: ' and ' }, { text: 'me', italic: true }] },
      { kind: 'ul', items: [[{ text: 'one' }], [{ text: 'two' }]] },
      { kind: 'ol', items: [[{ text: 'first' }]] },
    ])
    expect(parseNote('<script>x</script>')).toEqual([{ kind: 'p', spans: [{ text: '<script>x</script>' }] }])
  })
})
