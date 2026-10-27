import { describe, expect, it } from 'vitest'
import { addRecent, highlightParts, matchesAll, plainText, readRecents, searchAll, snippet } from '../app/lib/global-search-core'

describe('the search bar (Asana-style, 27 Oct 2026)', () => {
  const tasks = [
    { id: '1', title: 'Releeph EDMs (3 a week) and Blog (1 a week)', status: 'open', due_date: '2026-11-03' },
    { id: '2', title: 'Run this as a releeph ad please', status: 'open', due_date: '2026-10-30' },
    { id: '3', title: 'Releeph website', status: 'done' },
    { id: '4', title: 'Send akmal Blog template and copies', status: 'open' },
  ]
  const people = [{ id: 'a', name: 'Abby', email: 'contact@mdmmarketing.com.au' }, { id: 'k', name: 'Akmal', email: 'tech@mdmmarketing.com.au' }]
  const comments = [
    { id: 'c1', todo_id: '1', body: '<p>Weekly status: <b>attention</b> needed</p>', created_at: '2026-07-09' },
    { id: 'c2', todo_id: '2', body: 'Lance Grimmett on hold until Aug 18', created_at: '2026-07-15' },
  ]

  it('finds every word typed, in any order, ignoring case', () => {
    expect(matchesAll('Releeph EDMs (3 a week)', 'edm releeph')).toBe(true)
    expect(matchesAll('Releeph EDMs', 'releeph blog')).toBe(false)
  })
  it('puts open tasks first, the closest match next, then the soonest due', () => {
    expect(searchAll({ tasks, people, comments }, 'releeph').tasks.map(t => t.id)).toEqual(['1', '2', '3'])
  })
  it('finds people by name or email', () => {
    expect(searchAll({ tasks, people, comments }, 'tech@').people.map(p => p.id)).toEqual(['k'])
    expect(searchAll({ tasks, people, comments }, 'ab').people.map(p => p.id)).toEqual(['a'])
  })
  it('searches the words of a comment, not its markup, newest first', () => {
    expect(searchAll({ tasks, people, comments }, 'attention').messages.map(c => c.id)).toEqual(['c1'])
    expect(searchAll({ tasks, people, comments }, 'b').messages.map(c => c.id)).toEqual([])
    expect(plainText('<p>a&amp;b</p>')).toBe('a&b')
  })
  it('returns nothing for nothing typed', () => {
    expect(searchAll({ tasks, people, comments }, '  ')).toEqual({ tasks: [], projects: [], people: [], messages: [] })
  })
  it('shows the part of a long comment around the match', () => {
    const long = 'x '.repeat(80) + 'the deadline moved to Friday'
    expect(snippet(long, 'deadline')).toContain('deadline moved')
  })
  it('finds projects by name, closest first', () => {
    const projects = [{ id: 'p1', name: 'Real Deal Property' }, { id: 'p2', name: 'Releeph' }]
    expect(searchAll({ tasks, projects, people, comments }, 'rele').projects.map(p => p.id)).toEqual(['p2'])
  })
  it('bolds the letters typed, as Asana does ("rele" in Releeph)', () => {
    expect(highlightParts('Monthly EDMs for Releeph', 'rele')).toEqual([{ text: 'Monthly EDMs for ', hit: false }, { text: 'Rele', hit: true }, { text: 'eph', hit: false }])
    expect(highlightParts('Releeph EDMs', 'edm rele').filter(p => p.hit).map(p => p.text)).toEqual(['Rele', 'EDM'])
    expect(highlightParts('abc', 'zz')).toEqual([{ text: 'abc', hit: false }])
  })
  it('keeps recents newest first, once each, eight at most, and survives bad storage', () => {
    let r = addRecent([], { kind: 'task', id: '1' })
    r = addRecent(r, { kind: 'person', id: 'a' })
    r = addRecent(r, { kind: 'task', id: '1' })
    expect(r).toEqual([{ kind: 'task', id: '1' }, { kind: 'person', id: 'a' }])
    for (let i = 0; i < 20; i++) r = addRecent(r, { kind: 'project', id: String(i) })
    expect(r).toHaveLength(8)
    expect(readRecents('not json')).toEqual([])
    expect(readRecents('[{"kind":"evil","id":"x"},{"kind":"task","id":"2"}]')).toEqual([{ kind: 'task', id: '2' }])
  })
})
