import { describe, expect, it } from 'vitest'
import { groupBoxOf, groupScaleRange, scaleGroup } from '../app/lib/canvas-group-resize-core'
import type { CanvasCard } from '../app/lib/batch-brief-core'

/**
 * RESIZE A BUNCH OF CARDS TOGETHER (Renee, 24 Nov 2026: "an option to select a bunch of items and resize, now we can
 * select all to move but not resize"). The picked cards grow or shrink as one picture: every card by the same
 * amount, and the gaps between them with it, from the selection's top-left corner.
 */
const img = (id: string, x: number, y: number, w: number, h: number): CanvasCard => ({ id, kind: 'image', x, y, w, h, z: 1, url: 'https://x.test/a.jpg' })
const note = (id: string, x: number, y: number, w = 200): CanvasCard => ({ id, kind: 'note', x, y, w, z: 1, text: 'hi' })
const sizes = (cards: CanvasCard[], h = 100) => new Map(cards.map(c => [c.id, { w: c.w, h: c.h ?? h }]))

describe('the box around the picked cards', () => {
  it('runs from the top-left card to the bottom-right edge, by the sizes as drawn', () => {
    const cards = [img('a', 100, 100, 200, 150), img('b', 400, 300, 100, 100)]
    expect(groupBoxOf(cards, sizes(cards))).toEqual({ x: 100, y: 100, w: 400, h: 300 })
  })
  it('leaves out lines, and cards that sit in a column (the column places them)', () => {
    const cards: CanvasCard[] = [img('a', 0, 0, 100, 100), { ...note('k', 900, 900), col: 'c1' }, { id: 'l', kind: 'arrow', x: 5000, y: 5000, w: 240, z: 0, from: 'a', to: 'k' }]
    expect(groupBoxOf(cards, sizes(cards))).toEqual({ x: 0, y: 0, w: 100, h: 100 })
  })
  it('is nothing when no card can be resized', () => {
    expect(groupBoxOf([], new Map())).toBeNull()
  })
})

describe('resizing the picked cards together', () => {
  const cards = [img('a', 100, 100, 200, 150), img('b', 400, 300, 100, 100)]
  it('doubles every card and the gaps between them, from the top-left corner', () => {
    const out = scaleGroup(cards, sizes(cards), 2)
    expect(out.find(c => c.id === 'a')).toMatchObject({ x: 100, y: 100, w: 400, h: 300 })
    expect(out.find(c => c.id === 'b')).toMatchObject({ x: 700, y: 500, w: 200, h: 200 })
  })
  it('halves them the same way', () => {
    const big = [img('a', 0, 0, 400, 300), img('b', 600, 400, 400, 400)]
    const out = scaleGroup(big, sizes(big), 0.5)
    expect(out.find(c => c.id === 'a')).toMatchObject({ x: 0, y: 0, w: 200, h: 150 })
    expect(out.find(c => c.id === 'b')).toMatchObject({ x: 300, y: 200, w: 200, h: 200 })
  })
  it('a card whose height follows its words gets wider or narrower, and never a height of its own', () => {
    const n = [note('n', 0, 0, 200), img('a', 300, 0, 200, 200)]
    const out = scaleGroup(n, sizes(n), 1.5)
    expect(out.find(c => c.id === 'n')).toMatchObject({ w: 300 })
    expect(out.find(c => c.id === 'n')!.h).toBeUndefined()
  })
  it('returns only the cards that changed — a factor of 1 changes nothing', () => {
    expect(scaleGroup(cards, sizes(cards), 1)).toEqual([])
  })
  it('does not touch lines or cards in a column', () => {
    const mixed: CanvasCard[] = [...cards, { ...note('k', 900, 900), col: 'c1' }, { id: 'l', kind: 'arrow', x: 0, y: 0, w: 240, z: 0, from: 'a', to: 'b' }]
    expect(scaleGroup(mixed, sizes(mixed), 2).map(c => c.id).sort()).toEqual(['a', 'b'])
  })
  it('a line drawn on its own, picked with the cards, is stretched with them', () => {
    const free: CanvasCard = { id: 'f', kind: 'arrow', x: 0, y: 0, w: 240, z: 0, line: { fx: 100, fy: 100, tx: 300, ty: 200 } }
    const out = scaleGroup([...cards, free], sizes(cards), 2)
    expect(out.find(c => c.id === 'f')!.line).toMatchObject({ fx: 100, fy: 100, tx: 500, ty: 300 })
  })
})

describe('how far the group may go', () => {
  it('stops shrinking when the first card reaches its smallest size, so the group keeps its shape', () => {
    // an image may be 120 wide at least: the 200-wide one allows 0.6, the 480-wide one 0.25 — 0.6 it is
    const cards = [img('a', 0, 0, 200, 200), img('b', 300, 0, 480, 480)]
    expect(groupScaleRange(cards, sizes(cards)).min).toBeCloseTo(0.6)
  })
  it('a card already at its smallest cannot be shrunk with the group at all', () => {
    const cards = [img('a', 0, 0, 120, 120), img('b', 300, 0, 480, 480)]
    expect(groupScaleRange(cards, sizes(cards)).min).toBe(1)
  })
  it('a factor past the limit is held at the limit', () => {
    const cards = [img('a', 0, 0, 200, 200), img('b', 300, 0, 480, 480)]
    const out = scaleGroup(cards, sizes(cards), 0.1)
    expect(out.find(c => c.id === 'a')).toMatchObject({ w: 120, h: 120 })
    expect(out.find(c => c.id === 'b')).toMatchObject({ x: 180, w: 288, h: 288 })
  })
})
