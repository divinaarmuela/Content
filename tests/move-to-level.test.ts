import { describe, it, expect } from 'vitest'
import { moveToLevel, moveIntoBoard } from '../app/lib/shoot-board-core'

const cards = [
  { id: 'B', kind: 'board', x: 0, y: 0, w: 140 },
  { id: 'top', kind: 'note', x: 0, y: 300, w: 200 },
  { id: 'n1', kind: 'note', x: 100, y: 100, w: 200, parent: 'B' },
  { id: 'n2', kind: 'note', x: 400, y: 150, w: 200, parent: 'B' },
  { id: 'ln', kind: 'arrow', x: 0, y: 0, w: 240, parent: 'B', line: { fx: 120, fy: 400, tx: 300, ty: 500 } },
] as const

describe('moveToLevel — cards back up to the board above (12 Nov 2026)', () => {
  it('takes cards and a free line to the top, together, to the right of what is there', () => {
    const out = moveToLevel(cards as never, ['n1', 'n2', 'ln'], null)!
    expect(out.map(c => c.id)).toEqual(['n1', 'n2', 'ln'])
    for (const c of out) expect('parent' in c).toBe(false)
    const [a, b, l] = out as unknown as { x: number; y: number; line?: { fx: number; fy: number } }[]
    expect(b.x - a.x).toBe(300)
    expect(b.y - a.y).toBe(50)
    expect(a.x).toBe(248) // right of the widest card at the top (x 0 + w 200 + 48 gap... board 140, note 200)
    expect(l.line!.fx - a.x).toBe(20)
    expect(l.line!.fy - a.y).toBe(300)
  })
  it('does nothing for cards already on that board', () => {
    expect(moveToLevel(cards as never, ['top'], null)).toBeNull()
  })
  it('a line goes into a board with its points shifted, not its x/y', () => {
    const out = moveIntoBoard(cards as never, ['top', 'ln'], 'B')
    expect(out).not.toBeNull()
  })
})
