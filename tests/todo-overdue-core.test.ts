import { describe, expect, it } from 'vitest'
import {
  daysPast, daysSinceLastRun, overdueByOwner, overdueKey, overdueStage, overdueSubject, overdueToRemind, overdueWords,
} from '../app/lib/todo-overdue-core'

/**
 * OVERDUE TO-DO REMINDERS (the owner, 17 Nov 2026: "a day after a task is due
 * and 3 days after", to the assignee). The job runs weekday mornings, and a
 * person gets one email listing what became a day or three days late.
 *
 * November 2026: Mon 16, Tue 17, Wed 18, Thu 19, Fri 20, Sat 21, Sun 22, Mon 23.
 */
describe('which reminder a late to-do is owed', () => {
  it('counts whole days, and reads a longer stamp by its date', () => {
    expect(daysPast('2026-11-16', '2026-11-17')).toBe(1)
    expect(daysPast('2026-11-16T09:30:00Z', '2026-11-19')).toBe(3)
    expect(daysPast('', '2026-11-19')).toBeNull()
    expect(daysPast('not a date', '2026-11-19')).toBeNull()
  })
  it('knows when it last ran: Friday before a Monday, yesterday otherwise, never on a weekend', () => {
    expect(daysSinceLastRun('2026-11-16')).toBe(3)
    expect(daysSinceLastRun('2026-11-17')).toBe(1)
    expect(daysSinceLastRun('2026-11-20')).toBe(1)
    expect(daysSinceLastRun('2026-11-21')).toBeNull()
    expect(daysSinceLastRun('2026-11-22')).toBeNull()
  })
  it('a to-do due on a Monday: Tuesday the first, Thursday the second, and nothing in between or after', () => {
    const due = '2026-11-16'
    expect(overdueStage(due, '2026-11-16')).toBeNull()
    expect(overdueStage(due, '2026-11-17')).toBe('day1')
    expect(overdueStage(due, '2026-11-18')).toBeNull()
    expect(overdueStage(due, '2026-11-19')).toBe('day3')
    expect(overdueStage(due, '2026-11-20')).toBeNull()
    expect(overdueStage(due, '2026-11-23')).toBeNull()
  })
  it('over a weekend: due Friday is one mention on Monday (three days); due Thursday is Friday then Monday', () => {
    expect(overdueStage('2026-11-20', '2026-11-23')).toBe('day3')
    expect(overdueStage('2026-11-19', '2026-11-20')).toBe('day1')
    expect(overdueStage('2026-11-19', '2026-11-23')).toBe('day3')
    // due on the weekend itself: first met on Monday, a day or two late
    expect(overdueStage('2026-11-21', '2026-11-23')).toBe('day1')
    expect(overdueStage('2026-11-22', '2026-11-23')).toBe('day1')
    // …and its second mention comes when it is three days late
    expect(overdueStage('2026-11-21', '2026-11-24')).toBe('day3')
    expect(overdueStage('2026-11-22', '2026-11-25')).toBe('day3')
  })
  it('a to-do late for a month is never mentioned — switching this on empties no backlog', () => {
    expect(overdueStage('2026-10-01', '2026-11-17')).toBeNull()
    expect(overdueStage('2026-11-09', '2026-11-17')).toBeNull()
  })
  it('every to-do is mentioned exactly twice, whatever day it was due', () => {
    for (let d = 1; d <= 14; d++) {
      const due = `2026-11-${String(d).padStart(2, '0')}`
      const stages: string[] = []
      for (let t = d; t <= 30; t++) {
        const s = overdueStage(due, `2026-11-${String(t).padStart(2, '0')}`)
        if (s) stages.push(s)
      }
      // a Friday's two marks fall in one weekend and are said once, as the later
      const friday = new Date(`${due}T00:00:00Z`).getUTCDay() === 5
      expect(stages, due).toEqual(friday ? ['day3'] : ['day1', 'day3'])
    }
  })
  it('only open, assigned to-dos — grouped per person, the latest first', () => {
    const today = '2026-11-19'
    const todos = [
      { id: 'a', status: 'open', due_date: '2026-11-18', owner_id: 'u1' },
      { id: 'b', status: 'done', due_date: '2026-11-18', owner_id: 'u1' },
      { id: 'c', status: 'open', due_date: '2026-11-18', owner_id: null },
      { id: 'd', status: 'open', due_date: '2026-11-18', owner_id: 'u1', done_at: '2026-11-19T00:00:00Z' },
      { id: 'e', status: 'open', due_date: '2026-11-16', owner_id: 'u1' },
      { id: 'f', status: 'open', due_date: null, owner_id: 'u2' },
      { id: 'g', status: 'open', due_date: '2026-11-18', owner_id: 'u2' },
    ]
    const owed = overdueToRemind(todos, today)
    expect(owed.map(o => `${o.todo.id}:${o.stage}:${o.days}`)).toEqual(['a:day1:1', 'e:day3:3', 'g:day1:1'])
    const by = overdueByOwner(owed)
    expect([...by.keys()]).toEqual(['u1', 'u2'])
    expect(by.get('u1')!.map(o => o.todo.id)).toEqual(['e', 'a'])
  })
  it('says it in plain words, and is one email per person per morning', () => {
    expect(overdueWords(1)).toBe('1 day overdue')
    expect(overdueWords(3)).toBe('3 days overdue')
    expect(overdueSubject(['Schedule Luxe'])).toBe('Overdue: Schedule Luxe')
    expect(overdueSubject(['a', 'b', 'c'])).toBe('3 overdue to-dos')
    expect(overdueKey('t1', '2026-11-19')).toBe('t1#overdue#2026-11-19')
  })
})
