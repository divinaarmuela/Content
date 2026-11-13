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

describe('a long column, and where the search box is', () => {
  it('Approved shows ten, more on a press, and never hides the post an address points at', async () => {
    const { APPROVED_STEP, laneShown } = await import('../app/lib/pager-core')
    expect(APPROVED_STEP).toBe(10)
    expect(laneShown(10, Array(40).fill(false))).toBe(10)
    expect(laneShown(20, Array(40).fill(false))).toBe(20)
    const focused = Array(40).fill(false); focused[27] = true
    expect(laneShown(10, focused)).toBe(28)
    expect(laneShown(-3, [])).toBe(0)
    const { readFileSync } = await import('node:fs')
    const board = readFileSync('app/dashboard/scheduler/board/PostBoard.tsx', 'utf8')
    // every column, not Approved alone (the owner: "how about the other columns")
    expect(board).toContain('const shownGroups = groups.slice(0, laneShown(shownBy[key] ?? APPROVED_STEP,')
    expect(board).not.toContain("key === 'approved'")
    expect(board).toContain('setShownBy(m => ({ ...m, [key]: (m[key] ?? APPROVED_STEP) + APPROVED_STEP }))')
    // the column's number is every post, not the ten on screen
    expect(board).toContain('count: inLane.length')
  })
  it('the search box is drawn on To-dos and nowhere else', async () => {
    const { isTodosPage } = await import('../app/lib/pager-core')
    expect(isTodosPage('/dashboard/todos')).toBe(true)
    expect(isTodosPage('/dashboard/todos/project/abc')).toBe(true)
    for (const p of ['/dashboard', '/dashboard/scheduler', '/dashboard/clients', '/dashboard/todos-old', null]) expect(isTodosPage(p)).toBe(false)
    const { readFileSync } = await import('node:fs')
    expect(readFileSync('app/dashboard/ui/Shell.tsx', 'utf8')).toContain('{!reviewer && isTodosPage(path) && <GlobalSearch />}')
  })
})

describe('a post going out today is in one column', () => {
  it('is taken out of Approved, and out of nothing else', async () => {
    const { withoutToday } = await import('../app/lib/pager-core')
    const groups = [
      { lane: { key: 'draft' }, posts: [{ id: 'a' }, { id: 'x' }] },
      { lane: { key: 'approved' }, posts: [{ id: 'x' }, { id: 'y' }, { id: 'z' }] },
    ]
    const out = withoutToday(groups, new Set(['x', 'z']))
    expect(out[1].posts.map(p => p.id)).toEqual(['y'])
    expect(out[0].posts.map(p => p.id)).toEqual(['a', 'x'])
    expect(withoutToday(groups, new Set())[1].posts).toHaveLength(3)
    const { readFileSync } = await import('node:fs')
    const board = readFileSync('app/dashboard/scheduler/board/PostBoard.tsx', 'utf8')
    expect(board).toContain('withoutToday(groupedAll, todayIds)')
    expect(board).toContain('onIds={setTodayIdList}')
  })
})

describe('finding things on Post approval (the owner, 13 Nov 2026)', () => {
  it('a post is ordered by the latest of made, edited and moved', async () => {
    const { latestActivity, byLatestActivity } = await import('../app/lib/pager-core')
    expect(latestActivity({ created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-12T00:00:00Z', stage_at: '2026-11-05T00:00:00Z' })).toBe('2026-11-12T00:00:00Z')
    expect(latestActivity({ created_at: '2026-11-01T00:00:00Z', stage_at: '2026-11-05T00:00:00Z' })).toBe('2026-11-05T00:00:00Z')
    expect(latestActivity({})).toBe('')
    const rows = [{ id: 'old', at: '2026-11-01' }, { id: 'new', at: '2026-11-13' }, { id: 'mid', at: '2026-11-07' }, { id: 'mid2', at: '2026-11-07' }]
    expect(byLatestActivity(rows, r => r.at).map(r => r.id)).toEqual(['new', 'mid', 'mid2', 'old'])
  })
  it('search finds a post by its title, client or caption, whatever the case', async () => {
    const { matchesSearch } = await import('../app/lib/pager-core')
    const post = ['Founder story reel', 'ZZ Test Client', 'Comment CASHFLOW to get the planner']
    expect(matchesSearch(post, 'cashflow')).toBe(true)
    expect(matchesSearch(post, 'zz founder')).toBe(true)
    expect(matchesSearch(post, 'founder nothing')).toBe(false)
    expect(matchesSearch(post, '   ')).toBe(true)
  })
  it('the page has one toolbar: a real dropdown, a search box, and the chosen client goes to Calendar', async () => {
    const { readFileSync } = await import('node:fs')
    const page = readFileSync('app/dashboard/scheduler/page.tsx', 'utf8')
    expect(page).not.toMatch(/<select\b/)
    expect(page).toContain('<SelectTrigger aria-label="Show one client"')
    expect(page).toContain('aria-label="Search posts"')
    expect(page).toContain('posts={found}')
    const board = readFileSync('app/dashboard/scheduler/board/PostBoard.tsx', 'utf8')
    expect(board).toContain('byLatestActivity(g.posts, x => x.bp.activityAt)')
    expect(readFileSync('app/dashboard/scheduler/layout.tsx', 'utf8')).toContain("router.push(`${v.href}${addressWithClient('', chosen)}`)")
    expect(readFileSync('app/dashboard/scheduler/ScheduleCalendar.tsx', 'utf8')).toContain('e.content_items?.client_id === clientId')
  })
  it('Going out today reads earliest first', async () => {
    const { earliestFirst } = await import('../app/lib/today-posts-core')
    expect(earliestFirst([{ at: '2026-11-04T05:00:00Z' }, { at: '2026-11-04T01:00:00Z' }]).map(r => r.at)).toEqual(['2026-11-04T01:00:00Z', '2026-11-04T05:00:00Z'])
    const { readFileSync } = await import('node:fs')
    expect(readFileSync('app/api/social/today/route.ts', 'utf8')).toContain('rows: earliestFirst(rows.filter(r => r.going))')
  })
})

describe('the portal shows itself while it loads (the owner, 13 Nov 2026)', () => {
  it('has a loading screen with the portal header and tabs, and nothing about the client in it', async () => {
    const { readFileSync, existsSync } = await import('node:fs')
    expect(existsSync('app/portal/[token]/home/loading.tsx')).toBe(true)
    const src = readFileSync('app/portal/[token]/home/loading.tsx', 'utf8')
    expect(src).toContain('PORTAL_TABS.map')
    expect(src).toContain('aria-busy="true"')
    expect(src).toContain('animate-pulse')
    // drawn before anything is read: no data, no token
    expect(src).not.toMatch(/getPortalData|params|token|await /)
  })
})
