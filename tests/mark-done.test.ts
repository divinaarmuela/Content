import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { doneStillShown, donePatch, isMarkedDone, mayMarkDone } from '../app/lib/done-core'
import { groupByLane, pageLanes } from '../app/lib/board-view-core'

// 30 Oct 2026, the owner: "add a completed tab on each card it will then go to the last column in editor and designer"
// · "after 1 and a half weeks they will disappear" · "mark done can be during any stage" · "any AM, editor or super
// admin can do it"

describe('marking a card done', () => {
  it('an account manager, an editor or a super admin — nobody else', () => {
    expect(['account_manager', 'editor', 'super_admin'].map(role => mayMarkDone({ role }))).toEqual([true, true, true])
    expect(['scheduler', 'general', 'client', null].map(role => mayMarkDone({ role }))).toEqual([false, false, false, false])
  })
  it('a stamp, or cleared', () => {
    expect(donePatch(true, 'u1', '2026-10-30T01:00:00Z')).toEqual({ done_at: '2026-10-30T01:00:00Z', done_by: 'u1' })
    expect(donePatch(false, 'u1', '2026-10-30T01:00:00Z')).toEqual({ done_at: null, done_by: null })
    expect(isMarkedDone({ done_at: null })).toBe(false)
  })
  it('on the board for a week and a half, then off', () => {
    expect(doneStillShown({ done_at: '2026-10-20T05:00:00Z' }, '2026-10-30')).toBe(true)
    expect(doneStillShown({ done_at: '2026-10-19T05:00:00Z' }, '2026-10-30')).toBe(false)
    expect(doneStillShown({ done_at: null }, '2026-10-30')).toBe(true)
  })
  it('the Done lane on the Editor and Designer boards, at any stage; the Production board keeps its column', () => {
    const cards = [
      { id: 'a', status: 'draft_uploaded', done_at: '2026-10-30T01:00:00Z' },
      { id: 'b', status: 'quality_check', done_at: null },
    ] as never[]
    const editor = groupByLane(pageLanes('editor'), cards)
    expect(editor.find(g => g.lane.key === 'done')!.cards.map((c: { id: string }) => c.id)).toEqual(['a'])
    const prod = groupByLane(pageLanes('production'), cards)
    expect(prod.some(g => g.cards.some((c: { id: string }) => c.id === 'a') && g.lane.key !== 'done')).toBe(true)
  })
  it('wired: the route checks the role, both card menus and the card panel offer it', () => {
    expect(readFileSync('app/api/production/items/[id]/done/route.ts', 'utf8')).toContain('if (!mayMarkDone(user)) return NextResponse.json(')
    expect(readFileSync('app/dashboard/editor/EditorBoardCard.tsx', 'utf8')).toContain('Mark done')
    expect(readFileSync('app/dashboard/board/BoardCard.tsx', 'utf8')).toContain('Mark done')
    expect(readFileSync('app/dashboard/board/EditorCardDrawer.tsx', 'utf8')).toContain('data-mark-done="do"')
  })
})
