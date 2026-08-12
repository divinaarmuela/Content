import { describe, it, expect } from 'vitest'
import {
  bucketByDay, calendarColors, dayKey, shiftWeek, weekOf, type CalEvent,
} from '../app/lib/gcal-core'

const timed = (calendar: string, title: string, start: string, end: string): CalEvent =>
  ({ calendar, title, start, end, allDay: false })
const allDay = (calendar: string, title: string, start: string, end: string): CalEvent =>
  ({ calendar, title, start, end, allDay: true })

describe('dayKey', () => {
  it('converts a UTC instant to the Melbourne day', () => {
    // 20:00 UTC on the 11th is 06:00 AEST on the 12th
    expect(dayKey('2026-08-11T20:00:00Z')).toBe('2026-08-12')
  })

  it('keeps a mid-morning Melbourne instant on the same day', () => {
    expect(dayKey('2026-08-12T00:30:00Z')).toBe('2026-08-12')
  })
})

describe('weekOf', () => {
  it('returns the Monday-start week containing the day', () => {
    // 2026-08-12 is a Wednesday
    expect(weekOf('2026-08-12')).toEqual([
      '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13',
      '2026-08-14', '2026-08-15', '2026-08-16',
    ])
  })

  it('a Monday starts its own week and a Sunday ends one', () => {
    expect(weekOf('2026-08-10')[0]).toBe('2026-08-10')
    expect(weekOf('2026-08-16')[6]).toBe('2026-08-16')
  })

  it('crosses a month boundary', () => {
    expect(weekOf('2026-09-01')).toEqual([
      '2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03',
      '2026-09-04', '2026-09-05', '2026-09-06',
    ])
  })
})

describe('shiftWeek', () => {
  it('moves forward and back by whole weeks', () => {
    expect(shiftWeek('2026-08-12', 1)).toBe('2026-08-19')
    expect(shiftWeek('2026-08-12', -1)).toBe('2026-08-05')
  })
})

describe('bucketByDay', () => {
  const days = weekOf('2026-08-12')

  it('puts a timed event on its Melbourne start day', () => {
    // 23:00 UTC Tue = 09:00 AEST Wed
    const by = bucketByDay([timed('hello@x.com', 'Shoot', '2026-08-11T23:00:00Z', '2026-08-12T01:00:00Z')], days)
    expect(by.get('2026-08-12')).toHaveLength(1)
    expect(by.get('2026-08-11')).toHaveLength(0)
  })

  it('spreads an all-day event across its days, end exclusive', () => {
    const by = bucketByDay([allDay('hello@x.com', 'Away', '2026-08-12', '2026-08-14')], days)
    expect(by.get('2026-08-12')).toHaveLength(1)
    expect(by.get('2026-08-13')).toHaveLength(1)
    expect(by.get('2026-08-14')).toHaveLength(0)
  })

  it('drops events outside the window and sorts all-day first, then by start', () => {
    const by = bucketByDay([
      timed('a@x.com', 'Late', '2026-08-12T05:00:00Z', '2026-08-12T06:00:00Z'),
      timed('a@x.com', 'Early', '2026-08-12T01:00:00Z', '2026-08-12T02:00:00Z'),
      allDay('b@x.com', 'Whole day', '2026-08-12', '2026-08-13'),
      timed('a@x.com', 'Next week', '2026-08-19T01:00:00Z', '2026-08-19T02:00:00Z'),
    ], days)
    const titles = (by.get('2026-08-12') ?? []).map(e => e.title)
    expect(titles).toEqual(['Whole day', 'Early', 'Late'])
  })
})

describe('calendarColors', () => {
  it('assigns stable colours by sorted email, ignoring input order', () => {
    const a = calendarColors(['hello@x.com', 'contact@x.com'])
    const b = calendarColors(['contact@x.com', 'hello@x.com'])
    expect(a).toEqual(b)
    expect(a['contact@x.com']).not.toBe(a['hello@x.com'])
  })
})
