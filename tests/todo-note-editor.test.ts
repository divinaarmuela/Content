import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { continueList, dependableIds, formatNote, mayDependOn } from '../app/lib/todo-core'

// 28 Oct 2026: "when we type in description it lags", "they dont autosave", "the card description features"
describe('dependencies, in one pass', () => {
  it('says exactly what mayDependOn says, for every task', () => {
    const all = [
      { id: 'a', blocked_by: [] }, { id: 'b', blocked_by: ['a'] }, { id: 'c', blocked_by: ['b'] },
      { id: 'd', blocked_by: ['x'] }, { id: 'x', blocked_by: [] }, { id: 'e', blocked_by: ['c', 'd'] },
    ]
    for (const t of all) {
      const ok = dependableIds(t.id, all)
      for (const o of all) expect(ok.has(o.id)).toBe(mayDependOn(t.id, o.id, all))
    }
  })
  it('stays quick with hundreds of tasks', () => {
    const all = Array.from({ length: 2000 }, (_, i) => ({ id: `t${i}`, blocked_by: i ? [`t${i - 1}`] : [] }))
    const t0 = Date.now()
    expect(dependableIds('t1000', all).size).toBe(1000)
    expect(Date.now() - t0).toBeLessThan(200)
  })
})

describe('the description’s buttons', () => {
  it('Bold and Italic go on, and come off again', () => {
    const on = formatNote('make this loud', 5, 9, 'bold')
    expect(on).toEqual({ value: 'make **this** loud', a: 7, b: 11 })
    expect(formatNote(on.value, on.a, on.b, 'bold')).toEqual({ value: 'make this loud', a: 5, b: 9 })
    const it1 = formatNote('a b c', 2, 3, 'italic')
    expect(it1.value).toBe('a *b* c')
    expect(formatNote(it1.value, it1.a, it1.b, 'italic').value).toBe('a b c')
    // italic inside bold is added, not mistaken for taking the bold off
    expect(formatNote('**b**', 2, 3, 'italic').value).toBe('***b***')
  })
  it('a list button lists the lines, and on a list takes it off', () => {
    const ul = formatNote('one\ntwo', 0, 7, 'ul')
    expect(ul.value).toBe('- one\n- two')
    expect(formatNote(ul.value, 0, ul.value.length, 'ul').value).toBe('one\ntwo')
    expect(formatNote('- one\n- two', 0, 11, 'ol').value).toBe('1. one\n2. two')
  })
  it('Enter in a list starts the next item; on an empty one it ends the list', () => {
    expect(continueList('- milk', 6)).toEqual({ value: '- milk\n- ', caret: 9 })
    expect(continueList('1. one', 6)).toEqual({ value: '1. one\n2. ', caret: 10 })
    expect(continueList('- milk\n- ', 9)).toEqual({ value: '- milk\n', caret: 7 })
    expect(continueList('plain words', 11)).toBeNull()
  })
})

describe('the panel', () => {
  const s = readFileSync('app/dashboard/todos/TodoPanel.tsx', 'utf8')
  it('keeps the description in its own box, and never asks mayDependOn per key', () => {
    expect(s).toContain('const NoteEditor = memo(function NoteEditor(')
    expect(s).toContain("<NoteEditor key={t.id} todoId={t.id} saved={t.note ?? ''} editable={editable} onSaved={loadActivity} />")
    expect(s).not.toContain('mayDependOn(')
    expect(s).toContain('dependableIds(t.id, all as never)')
    // the comment box keeps its own words too
    expect(s).toContain('const CommentComposer = memo(function CommentComposer(')
    expect(s).toContain('<CommentComposer todoId={t.id} members={members} send={send} />')
  })
  it('saves after a pause, on leaving, and as the tab goes — and says so', () => {
    expect(s).toContain("window.addEventListener('pagehide', flush)")
    expect(s).toContain('keepalive })')
    expect(s).toContain("'Saving…'")
  })
})
