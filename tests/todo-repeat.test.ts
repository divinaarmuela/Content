import { describe, expect, it } from 'vitest'
import { nextDue, nextTodoId, normaliseRepeat, repeatWords } from '../app/lib/todo-repeat-core'

/**
 * REPEATING TO-DOS (Manal, 20 Oct 2026). The weekly cases are Asana's own record of her "Releeph UGC Creators":
 * done Fri 16 Oct → next due Mon 19 Oct; done Mon 19 Oct → next due Tue 20 Oct (Mon–Fri).
 */
describe('nextDue', () => {
  const weekdays = normaliseRepeat({ freq: 'weekly', days: [0, 1, 2, 3, 4] })!

  it('weekly on Mon–Fri skips the weekend, as Asana did for Manal', () => {
    expect(nextDue(weekdays, '2026-10-16', '2026-10-16')).toBe('2026-10-19')
    expect(nextDue(weekdays, '2026-10-19', '2026-10-19')).toBe('2026-10-20')
  })

  it('counts from the due date, not the day it was ticked', () => {
    expect(nextDue(weekdays, '2026-10-16', '2026-10-20')).toBe('2026-10-19')
  })

  it('daily, monthly (end of month clamped) and yearly', () => {
    expect(nextDue({ freq: 'daily' }, '2026-10-31', '2026-10-31')).toBe('2026-11-01')
    expect(nextDue({ freq: 'monthly' }, '2026-01-31', '2026-01-31')).toBe('2026-02-28')
    expect(nextDue({ freq: 'yearly' }, '2028-02-29', '2028-02-29')).toBe('2029-02-28')
  })

  it("monthly on a chosen day, as Manal asked (Asana's \"On day 20\")", () => {
    expect(nextDue({ freq: 'monthly', day: 20 }, '2026-10-20', '2026-10-20')).toBe('2026-11-20')
    expect(nextDue({ freq: 'monthly', day: 20 }, '2026-10-05', '2026-10-05')).toBe('2026-11-20')
    expect(nextDue({ freq: 'monthly', day: 'last' }, '2026-01-31', '2026-01-31')).toBe('2026-02-28')
    expect(nextDue({ freq: 'custom', every: 3, unit: 'month', day: 1 }, '2026-10-20', '2026-10-20')).toBe('2027-01-01')
  })

  it('periodically counts from the day it was done', () => {
    expect(nextDue({ freq: 'periodically', every: 3 }, '2026-10-10', '2026-10-20')).toBe('2026-10-23')
  })

  it('custom every N days, weeks or months', () => {
    expect(nextDue({ freq: 'custom', every: 2, unit: 'week' }, '2026-10-20', '2026-10-20')).toBe('2026-11-03')
    expect(nextDue({ freq: 'custom', every: 10, unit: 'day' }, '2026-10-20', '2026-10-20')).toBe('2026-10-30')
    expect(nextDue({ freq: 'custom', every: 3, unit: 'month' }, '2026-10-20', '2026-10-20')).toBe('2027-01-20')
  })

  it('a task with no due date counts from the day it was done', () => {
    expect(nextDue({ freq: 'daily' }, null, '2026-10-20')).toBe('2026-10-21')
  })
})

describe('the rule, made safe', () => {
  it('drops anything that is not a rule', () => {
    expect(normaliseRepeat(null)).toBeNull()
    expect(normaliseRepeat({ freq: 'hourly' })).toBeNull()
  })
  it('weekly with no days ticked means weekdays; numbers are kept sane', () => {
    expect(normaliseRepeat({ freq: 'weekly', days: [] })!.days).toEqual([0, 1, 2, 3, 4])
    expect(normaliseRepeat({ freq: 'weekly', days: [4, 9, 0, 0] })!.days).toEqual([0, 4])
    expect(normaliseRepeat({ freq: 'custom', every: -2, unit: 'fortnight' })).toEqual({ freq: 'custom', every: 1, unit: 'week' })
    expect(normaliseRepeat({ freq: 'monthly', day: 31 })).toEqual({ freq: 'monthly' })
    expect(normaliseRepeat({ freq: 'weekly', day: 5 })!.day).toBeUndefined()
  })
  it('says the rule in words', () => {
    expect(repeatWords(normaliseRepeat({ freq: 'weekly', days: [0, 1, 2, 3, 4] }))).toBe('Weekly on Mon–Fri')
    expect(repeatWords({ freq: 'weekly', days: [0, 2] })).toBe('Weekly on Mon, Wed')
    expect(repeatWords({ freq: 'periodically', every: 1 })).toBe("1 day after it's done")
    expect(repeatWords(null)).toBe("Doesn't repeat")
    expect(repeatWords(normaliseRepeat({ freq: 'monthly', day: 20 }))).toBe('Monthly on the 20th')
    expect(repeatWords(normaliseRepeat({ freq: 'custom', every: 3, unit: 'month', day: 'last' }))).toBe('Every 3 months on the last day')
    expect(repeatWords(normaliseRepeat({ freq: 'monthly', day: 22 }))).toBe('Monthly on the 22nd')
  })
  it('the next task has one id per task, and the id never grows round after round', () => {
    expect(nextTodoId('abc')).toBe(nextTodoId('abc'))
    expect(nextTodoId('abc')).not.toBe(nextTodoId('abd'))
    let id = '9ee0deec-c464-4761-bc8f-8de05f791f86'
    for (let i = 0; i < 400; i++) id = nextTodoId(id)
    expect(id.length).toBeLessThanOrEqual(17)
    expect(id).toMatch(/^rp_[0-9a-z]+$/)
  })
})
