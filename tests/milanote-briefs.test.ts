import { describe, expect, it } from 'vitest'
import { boardFromSource, isShootBriefName, pastBriefHref, pastBriefs } from '../app/lib/milanote-briefs-core'

describe('past briefs from Milanote, on Shoots (20 Oct 2026)', () => {
  it("knows a shoot's plan by its name", () => {
    for (const n of ['SHOOT 4', 'Shoot Brief 6/5', 'first shoot 29th AUG', 'Shooy Brief 1/5', 'Shot list - video #4']) expect(isShootBriefName(n)).toBe(true)
    for (const n of ['Graphics', 'Inspo Board', 'September 2025']) expect(isShootBriefName(n)).toBe(false)
  })

  it('finds them inside the imported boards, with where they sit, and never on a board made here or archived', () => {
    const boards = [
      { id: 'tb1', name: 'Luxe laser', client_id: 'c1', milanote_id: 'm1', canvas_cards: [
        { id: 'g', kind: 'board', name: 'Graphics' },
        { id: 's4', kind: 'board', name: 'SHOOT 4' },
        { id: 'n', kind: 'note', parent: 's4' }, { id: 'a', kind: 'arrow', parent: 's4' },
      ] },
      { id: 'tb2', name: 'Shoot plan we made', client_id: 'c1', canvas_cards: [] },
      { id: 'tb3', name: 'Old shoot', client_id: 'c1', milanote_id: 'm3', archived_at: '2026-10-20', canvas_cards: [] },
    ]
    expect(pastBriefs(boards)).toEqual([{ teamBoardId: 'tb1', boardCardId: 's4', title: 'SHOOT 4', clientId: 'c1', path: 'Luxe laser › SHOOT 4', cards: 1 }])
    expect(pastBriefHref({ teamBoardId: 'tb1', boardCardId: 's4' })).toBe('/dashboard/production/past/tb1?board=s4')
  })

  it('the Boards filter: all, the team’s own, or from Milanote', () => {
    expect(boardFromSource({ milanote_id: 'x' }, 'milanote')).toBe(true)
    expect(boardFromSource({ milanote_id: 'x' }, 'here')).toBe(false)
    expect(boardFromSource({}, 'here')).toBe(true)
    expect(boardFromSource({}, 'all')).toBe(true)
  })
})
