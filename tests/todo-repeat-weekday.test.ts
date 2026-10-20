import { describe, expect, it } from 'vitest'
import { nextDue, normaliseRepeat, repeatWords, upcomingDues } from '../app/lib/todo-repeat-core'

describe('monthly by weekday, and when it comes round (Manal, 20 Oct 2026)', () => {
  it('"On the last Monday": the next is the last Monday of the next month', () => {
    const r = normaliseRepeat({ freq: 'monthly', on: { nth: 'last', weekday: 0 } })!
    expect(r.on).toEqual({ nth: 'last', weekday: 0 })
    expect(nextDue(r, '2026-10-26', '2026-10-26')).toBe('2026-11-30')
    expect(nextDue(r, '2026-11-30', '2026-11-30')).toBe('2026-12-28')
    expect(repeatWords(r)).toBe('Monthly on the last Monday')
  })

  it('"On the first Tuesday", and every 3 months on the second Friday', () => {
    expect(nextDue(normaliseRepeat({ freq: 'monthly', on: { nth: 1, weekday: 1 } })!, '2026-10-06', '2026-10-06')).toBe('2026-11-03')
    const q = normaliseRepeat({ freq: 'custom', every: 3, unit: 'month', on: { nth: 2, weekday: 4 } })!
    expect(nextDue(q, '2026-10-09', '2026-10-09')).toBe('2027-01-08')
    expect(repeatWords(q)).toBe('Every 3 months on the second Friday')
  })

  it('a weekday rule wins over a date; nonsense is dropped', () => {
    expect(normaliseRepeat({ freq: 'monthly', day: 20, on: { nth: 'last', weekday: 0 } })!.day).toBeUndefined()
    expect(normaliseRepeat({ freq: 'monthly', on: { nth: 9, weekday: 0 } })!.on).toBeUndefined()
    expect(normaliseRepeat({ freq: 'monthly', on: { nth: 1, weekday: 7 } })!.on).toBeUndefined()
  })

  it('the coming dates, for the calendar: on the 20th, on the last day, weekly; none for "after it is done"', () => {
    expect(upcomingDues(normaliseRepeat({ freq: 'monthly', day: 20 }), '2026-10-20', 3)).toEqual(['2026-11-20', '2026-12-20', '2027-01-20'])
    expect(upcomingDues(normaliseRepeat({ freq: 'monthly', day: 'last' }), '2026-10-31', 3)).toEqual(['2026-11-30', '2026-12-31', '2027-01-31'])
    expect(upcomingDues(normaliseRepeat({ freq: 'weekly', days: [0, 2] }), '2026-10-19', 3)).toEqual(['2026-10-21', '2026-10-26', '2026-10-28'])
    expect(upcomingDues(normaliseRepeat({ freq: 'periodically', every: 3 }), '2026-10-20')).toEqual([])
    expect(upcomingDues(null, '2026-10-20')).toEqual([])
  })
})

describe('custom: every N weeks, on these days if needed (Manal, 21 Oct 2026)', () => {
  // 2026-10-19 is a Monday
  it('moves to the next chosen day this week, then N weeks on to the first chosen day', async () => {
    const { nextDue, normaliseRepeat, repeatWords } = await import('../app/lib/todo-repeat-core')
    const r = normaliseRepeat({ freq: 'custom', every: 2, unit: 'week', days: [2, 0] })!
    expect(r.days).toEqual([0, 2])
    expect(nextDue(r, '2026-10-19', '2026-10-19')).toBe('2026-10-21')   // Mon → Wed, same week
    expect(nextDue(r, '2026-10-21', '2026-10-21')).toBe('2026-11-02')   // Wed → Mon two weeks on
    expect(repeatWords(r)).toBe('Every 2 weeks on Mon, Wed')
  })
  it('with no days chosen, it is the same weekday every N weeks, as before', async () => {
    const { nextDue, normaliseRepeat } = await import('../app/lib/todo-repeat-core')
    const r = normaliseRepeat({ freq: 'custom', every: 3, unit: 'week' })!
    expect(r.days).toBeUndefined()
    expect(nextDue(r, '2026-10-21', '2026-10-21')).toBe('2026-11-11')
  })
})
