import { describe, it, expect } from 'vitest'
import { moveIntoBoard } from '../app/lib/shoot-board-core'

type C = { id: string; kind: string; x: number; y: number; w: number; parent?: string }
const card = (id: string, x: number, y: number, extra: Partial<C> = {}): C => ({ id, kind: 'note', x, y, w: 200, ...extra })

describe('drop notes into a board (4 Nov 2026)', () => {
  it('moves the cards inside, keeping their layout, to the right of what is there', () => {
    const cards = [card('b', 0, 0, { kind: 'board' }), card('in', 10, 20, { parent: 'b' }), card('n1', 500, 500), card('n2', 500, 560)]
    const out = moveIntoBoard(cards, ['n1', 'n2'], 'b')!
    expect(out.map(c => [c.id, c.parent, c.x, c.y])).toEqual([['n1', 'b', 258, 20], ['n2', 'b', 258, 80]])
  })
  it('an empty board takes them at its start', () => {
    const out = moveIntoBoard([card('b', 0, 0, { kind: 'board' }), card('n', 300, 400)], ['n'], 'b')!
    expect(out[0]).toMatchObject({ parent: 'b', x: 0, y: 0 })
  })
  it('refuses a board dropped into itself or its own board', () => {
    const cards = [card('a', 0, 0, { kind: 'board' }), card('b', 0, 0, { kind: 'board', parent: 'a' })]
    expect(moveIntoBoard(cards, ['a'], 'b')).toBeNull()
    expect(moveIntoBoard(cards, ['a'], 'a')).toBeNull()
  })
})
