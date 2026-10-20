import { describe, expect, it } from 'vitest'
import type { CanvasCard } from '../app/lib/batch-brief-core'
import {
  COLUMN_COLOURS, NEW_COLUMN, columnAt, columnChildren, dropIndex, fitsInColumn, placeInColumn, takeOutOfColumn,
} from '../app/lib/canvas-column-core'

const card = (id: string, extra: Partial<CanvasCard> = {}): CanvasCard =>
  ({ id, kind: 'note', x: 0, y: 0, z: 1, w: 200, text: id, ...extra }) as CanvasCard

describe("Milanote's columns on the board (the owner, 20 Oct 2026)", () => {
  const cols = [
    { id: 'a', x: 0, y: 0, w: 300, h: 400, z: 1 },
    { id: 'b', x: 200, y: 100, w: 300, h: 400, z: 5 },
  ]

  it('a drop lands in the column under it, the topmost where two overlap, never in itself', () => {
    expect(columnAt({ x: 50, y: 50 }, cols, 'n')).toBe('a')
    expect(columnAt({ x: 250, y: 150 }, cols, 'n')).toBe('b')
    expect(columnAt({ x: 250, y: 150 }, cols, 'b')).toBe('a')
    expect(columnAt({ x: 900, y: 900 }, cols, 'n')).toBeNull()
  })

  it('a column and an arrow never go in a column', () => {
    expect(fitsInColumn('column')).toBe(false)
    expect(fitsInColumn('arrow')).toBe(false)
    expect(fitsInColumn('note')).toBe(true)
    expect(fitsInColumn('image')).toBe(true)
    expect(placeInColumn([card('c', { kind: 'column' }), card('d', { kind: 'column' })], 'd', 'c', 0)).toEqual([])
  })

  it('the place in the column is where it was dropped: above the middle of a card goes before it', () => {
    const kids = [{ top: 0, bottom: 100 }, { top: 110, bottom: 210 }]
    expect(dropIndex(20, kids)).toBe(0)
    expect(dropIndex(80, kids)).toBe(1)
    expect(dropIndex(500, kids)).toBe(2)
    expect(dropIndex(5, [])).toBe(0)
  })

  it('a card dropped in is placed and its new neighbours renumbered; only what changed is saved', () => {
    const cards = [card('col', { kind: 'column' }), card('x', { col: 'col', ord: 0 }), card('y', { col: 'col', ord: 1 }), card('n')]
    const changed = placeInColumn(cards, 'n', 'col', 1)
    expect(changed.map(c => [c.id, c.col, c.ord])).toEqual([['n', 'col', 1], ['y', 'col', 2]])
  })

  it('reordering inside the same column moves the card, not a copy', () => {
    const cards = [card('col', { kind: 'column' }), card('x', { col: 'col', ord: 0 }), card('y', { col: 'col', ord: 1 }), card('z', { col: 'col', ord: 2 })]
    const changed = placeInColumn(cards, 'z', 'col', 0)
    const after = cards.map(c => changed.find(x => x.id === c.id) ?? c)
    expect(columnChildren(after, 'col').map(c => c.id)).toEqual(['z', 'x', 'y'])
  })

  it('moving to another column takes it out of the first', () => {
    const cards = [card('a', { kind: 'column' }), card('b', { kind: 'column' }), card('x', { col: 'a', ord: 0 })]
    const [moved] = placeInColumn(cards, 'x', 'b', 0)
    expect(moved.col).toBe('b')
  })

  it('dragged out, a card is back on the board where it was let go, with no column', () => {
    const out = takeOutOfColumn(card('x', { col: 'a', ord: 3 }), 120, 340, 9)
    expect(out).toMatchObject({ x: 120, y: 340, z: 9 })
    expect('col' in out).toBe(false)
    expect('ord' in out).toBe(false)
  })

  it('a new column is "New Column" and empty; the colours start with none', () => {
    expect(NEW_COLUMN).toEqual({ kind: 'column', name: 'New Column', w: 300 })
    expect(COLUMN_COLOURS[0].hex).toBeUndefined()
    for (const c of COLUMN_COLOURS.slice(1)) expect(c.hex).toMatch(/^#[0-9a-f]{6}$/)
  })
})
