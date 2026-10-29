import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// 29 Oct 2026: "have u done for the shoots? editors? designers?" — every card drew again on any change anywhere
describe('the boards redraw only the card that changed', () => {
  it('the cards are memoised, and the board hands them steady inputs', () => {
    const s = readFileSync('app/dashboard/board/Board.tsx', 'utf8')
    for (const c of ['const BoardCardM = memo(BoardCard)', 'const EditorBoardCardM = memo(EditorBoardCard)', 'const CompactCardM = memo(CompactCard)']) expect(s).toContain(c)
    expect(s).toContain('managers={managersFor(c.client_id)}')
    expect(s).toContain('onArchive={mayArchiveCard(viewer, c as never) ? archiveCard : undefined}')
    expect(s).toContain('onAcknowledge={onAcknowledge ? acknowledgeCard : undefined}')
    // no handler made fresh per card per render
    const cards = s.slice(s.indexOf('<EditorBoardCardM'), s.indexOf('</div>', s.indexOf('<BoardCardM')))
    expect(cards).not.toMatch(/=\{[a-zA-Z]+ => /)
  })
  it('the rows behind them keep their objects while unchanged', () => {
    expect(readFileSync('app/dashboard/useLiveWork.ts', 'utf8')).toContain('const steadyItems = useSteadyRows(allItems)')
    for (const p of ['app/dashboard/editor/page.tsx', 'app/dashboard/designer/page.tsx']) expect(readFileSync(p, 'utf8')).toContain('const steadyCards = useSteadyRows(allCards)')
  })
})
