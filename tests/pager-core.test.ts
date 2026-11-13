import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { clampPage, firstUpcoming, pageCount, pageOfIndex, pageSlice, pageWords } from '../app/lib/pager-core'

/** THE OVERVIEW'S LISTS, A FEW AT A TIME (the owner, 13 Nov 2026). */
describe('pager-core', () => {
  const rows = Array.from({ length: 12 }, (_, i) => i + 1)
  it('counts pages, never fewer than one', () => {
    expect(pageCount(12, 5)).toBe(3)
    expect(pageCount(10, 5)).toBe(2)
    expect(pageCount(0, 5)).toBe(1)
  })
  it('gives a page its rows and never walks off either end', () => {
    expect(pageSlice(rows, 0, 5)).toEqual([1, 2, 3, 4, 5])
    expect(pageSlice(rows, 2, 5)).toEqual([11, 12])
    expect(pageSlice(rows, 9, 5)).toEqual([11, 12])
    expect(pageSlice(rows, -3, 5)).toEqual([1, 2, 3, 4, 5])
    expect(clampPage(NaN, 12, 5)).toBe(0)
  })
  it('says where you are in plain numbers', () => {
    expect(pageWords(0, 12, 5)).toBe('1–5 of 12')
    expect(pageWords(2, 12, 5)).toBe('11–12 of 12')
    expect(pageWords(2, 11, 5)).toBe('11 of 11')
    expect(pageWords(0, 0, 5)).toBe('')
  })
  it('today opens on what is coming up next, and on the end of the day once it is all over', () => {
    const day = ['06:30', '09:00', '14:00', '14:00', '14:00', '15:00', '15:00', '18:30'].map(t => ({ at: `2026-11-13T${t}` }))
    expect(firstUpcoming(day, '2026-11-13T11:22')).toBe(2)
    expect(pageOfIndex(firstUpcoming(day, '2026-11-13T11:22'), day.length, 5)).toBe(0)
    expect(pageOfIndex(firstUpcoming(day, '2026-11-13T14:30'), day.length, 5)).toBe(1)
    expect(firstUpcoming(day, '2026-11-13T23:00')).toBe(7)
    expect(firstUpcoming(day, null)).toBe(0)
    expect(firstUpcoming([], '2026-11-13T11:22')).toBe(0)
  })
})

describe('Overview: Today is paged, and the clients\u2019 comments are on it', () => {
  const page = readFileSync('app/dashboard/page.tsx', 'utf8')
  it('shows five of today at a time with a pager under them', () => {
    expect(page).toContain('const TODAY_SIZE = 5')
    expect(page).toContain('<Timeline items={pageSlice(todayItems, todayPage, TODAY_SIZE)}')
    expect(page).toContain('<Pager page={todayPage} total={todayItems.length} size={TODAY_SIZE}')
  })
  it('has the recent client comments, each opening its post, hidden from those who may not read them', () => {
    expect(page).toContain('<RecentClientComments />')
    const panel = readFileSync('app/dashboard/RecentClientComments.tsx', 'utf8')
    expect(panel).toContain("fetch('/api/social/client-comments'")
    expect(panel).toContain('href={`/dashboard/scheduler?post=${encodeURIComponent(r.post_id)}`}')
    expect(panel).toContain('if (res.status === 401 || res.status === 403) { setHidden(true); return }')
  })
})
