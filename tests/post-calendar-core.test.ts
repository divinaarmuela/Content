import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { MONTH_CELL_MAX, dayWords, groupByDay, isDayKey, monthOfDay, rangeWords, shiftDay, shiftMonthDay, weekKeys } from '../app/lib/post-calendar-core'

describe('Post approval calendar: days and weeks', () => {
  it('a week runs Monday to Sunday, across a month end', () => {
    expect(weekKeys('2026-11-13')).toEqual(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'])
    expect(weekKeys('2026-11-30')[6]).toBe('2026-12-06')
    expect(weekKeys('2026-11-15')[0]).toBe('2026-11-09') // a Sunday belongs to the week that started on Monday
  })
  it('steps by a week and by a month, holding the day inside a shorter month', () => {
    expect(shiftDay('2026-11-13', 7)).toBe('2026-11-20')
    expect(shiftDay('2026-12-29', 7)).toBe('2027-01-05')
    expect(shiftMonthDay('2027-01-31', 1)).toBe('2027-02-28')
    expect(shiftMonthDay('2026-11-13', -1)).toBe('2026-10-13')
    expect(monthOfDay('2026-11-13')).toBe('2026-11')
  })
  it('says where you are in plain words', () => {
    expect(rangeWords('month', '2026-11-13')).toBe('November 2026')
    expect(rangeWords('week', '2026-11-13')).toBe('9 – 15 Nov 2026')
    expect(rangeWords('week', '2026-11-30')).toBe('30 Nov – 6 Dec 2026')
    expect(dayWords('2026-11-09')).toBe('Monday 9 November 2026')
    expect(isDayKey('2026-11-09')).toBe(true)
    expect(isDayKey('9 Nov')).toBe(false)
  })
  it('puts each post on its own day, earliest first, and leaves out a post with no time', () => {
    const posts = [{ id: 'late', at: '2026-11-09T09:00:00Z', day: '2026-11-09' }, { id: 'none', at: '', day: null }, { id: 'early', at: '2026-11-09T01:00:00Z', day: '2026-11-09' }, { id: 'next', at: '2026-11-10T01:00:00Z', day: '2026-11-10' }]
    const by = groupByDay(posts, p => p.day, p => p.at)
    expect(by.get('2026-11-09')!.map(p => p.id)).toEqual(['early', 'late'])
    expect(by.get('2026-11-10')!.map(p => p.id)).toEqual(['next'])
    expect([...by.values()].flat().some(p => p.id === 'none')).toBe(false)
  })
})

describe('Post approval calendar: the page (the owner, 13 Nov 2026)', () => {
  const cal = readFileSync('app/dashboard/scheduler/PostCalendar.tsx', 'utf8')
  it('is the calendar the Calendar tab draws, one tile per post, opening the post', () => {
    expect(readFileSync('app/dashboard/scheduler/calendar/page.tsx', 'utf8')).toContain('<PostCalendar />')
    expect(cal).toContain('href={postApprovalWindowHref(post)}')
    expect(cal).toContain('<NetworkLogos platforms={face.networks.map(n => n.platform)}')
    expect(readFileSync('app/dashboard/scheduler/board/usePostBoard.ts', 'utf8')).toContain("visible.filter(p => p.stage !== 'cancelled' && !!p.scheduled_for).map(decorate)")
  })
  it('a week shows every post; a month shows the first few and opens the rest in the middle of the screen', () => {
    expect(MONTH_CELL_MAX).toBe(4)
    expect(cal).toContain("const shown = range === 'week' ? list : list.slice(0, MONTH_CELL_MAX)")
    expect(cal).toContain('className="fixed inset-0 z-50 flex items-center justify-center')
    expect(cal).not.toMatch(/absolute left-0 top-full/)
  })
  it('keeps the client chosen on the board, in a real dropdown, and each post in its own client zone', () => {
    expect(cal).toContain('clientFromAddress(window.location.search)')
    expect(cal).not.toMatch(/<select\b/)
    expect(cal).toContain('dayKeyInZone(bp.post.scheduled_for, zoneOf(bp.post.client_id))')
  })
  it('is read-only: nothing here writes', () => {
    expect(cal).not.toMatch(/method: '(POST|PUT|PATCH|DELETE)'/)
  })
})
