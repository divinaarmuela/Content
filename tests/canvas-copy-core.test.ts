import { describe, expect, it } from 'vitest'
import { cardsToCopy, copiedWords, pasteCards, pasteFits, readCopied, writeCopied } from '../app/lib/canvas-copy-core'
import { applyCanvasOp, CANVAS_MAX_CARDS, type CanvasCard } from '../app/lib/batch-brief-core'

/**
 * COPY AND PASTE CARDS (Renee, 24 Nov 2026: "copy paste function on shoot brief doesn't work … would be good to
 * select and copy then paste"; the owner: a board tile brings what is inside it). Pick cards, Ctrl+C, Ctrl+V on the
 * same board or another one.
 */

const note = (id: string, x: number, y: number, extra: Partial<CanvasCard> = {}): CanvasCard =>
  ({ id, kind: 'note', x, y, w: 200, z: 1, text: id, ...extra })
const tile = (id: string, x: number, y: number, extra: Partial<CanvasCard> = {}): CanvasCard =>
  ({ id, kind: 'board', x, y, w: 176, z: 1, name: id, ...extra })
const join = (id: string, from: string, to: string, extra: Partial<CanvasCard> = {}): CanvasCard =>
  ({ id, kind: 'arrow', x: 0, y: 0, w: 240, z: 0, from, to, ...extra })

// the top board: two notes joined by an arrow, a third note, and a board "concepts" holding a note, a column with
// one card in it, and a board "day2" holding one note
const brief: CanvasCard[] = [
  note('n1', 100, 100), note('n2', 400, 100), note('n3', 100, 400),
  join('a12', 'n1', 'n2'), join('a13', 'n1', 'n3'),
  tile('concepts', 700, 100),
  note('c1', 0, 0, { parent: 'concepts' }),
  { id: 'col', kind: 'column', x: 300, y: 0, w: 300, z: 1, name: 'Day 1', parent: 'concepts' },
  note('k1', 0, 0, { parent: 'concepts', col: 'col', ord: 0 }),
  tile('day2', 0, 300, { parent: 'concepts' }),
  note('d1', 40, 40, { parent: 'day2' }),
  join('ac', 'c1', 'day2', { parent: 'concepts' }),
]
const ids = (cs: readonly CanvasCard[]) => cs.map(c => c.id).sort()

describe('what a copy takes', () => {
  it('takes the picked cards and nothing else', () => {
    expect(ids(cardsToCopy(brief, ['n3']))).toEqual(['n3'])
  })
  it('takes a board with everything inside it, to any depth', () => {
    expect(ids(cardsToCopy(brief, ['concepts']))).toEqual(['ac', 'c1', 'col', 'concepts', 'd1', 'day2', 'k1'])
  })
  it('takes a column with the cards in it', () => {
    expect(ids(cardsToCopy(brief, ['col']))).toEqual(['col', 'k1'])
  })
  it('takes a line when both cards it joins are copied', () => {
    expect(ids(cardsToCopy(brief, ['n1', 'n2']))).toEqual(['a12', 'n1', 'n2'])
  })
  it('leaves a line behind when one of its cards is not copied, even if the line was picked', () => {
    expect(ids(cardsToCopy(brief, ['n1', 'a13']))).toEqual(['n1'])
  })
  it('takes a picked line that is drawn on its own', () => {
    const free: CanvasCard = { id: 'f', kind: 'arrow', x: 0, y: 0, w: 240, z: 0, line: { fx: 10, fy: 10, tx: 90, ty: 50 } }
    expect(ids(cardsToCopy([...brief, free], ['f']))).toEqual(['f'])
  })
  it('ignores ids that are not on the board', () => {
    expect(cardsToCopy(brief, ['nope'])).toEqual([])
  })
})

describe('what a paste makes', () => {
  let n = 0
  const mint = () => `new${++n}`
  const paste = (picked: string[], parent: string | null, at = { x: 1000, y: 2000 }) =>
    pasteCards(cardsToCopy(brief, picked), { parent, at, z: 50, mint })

  it('gives every card a new id, so the originals are untouched', () => {
    const out = paste(['n1', 'n2'], null)
    expect(out.cards).toHaveLength(3)
    for (const c of out.cards) expect(brief.some(b => b.id === c.id)).toBe(false)
  })
  it('keeps the cards laid out as they were, with the group\'s corner where it was asked for', () => {
    const out = paste(['n1', 'n2', 'n3'], null)
    const at = (text: string) => { const c = out.cards.find(x => x.text === text)!; return [c.x, c.y] }
    expect(at('n1')).toEqual([1000, 2000])
    expect(at('n2')).toEqual([1300, 2000])
    expect(at('n3')).toEqual([1000, 2300])
  })
  it('lands on the board that is open', () => {
    expect(paste(['n3'], 'day2').cards[0].parent).toBe('day2')
    expect(paste(['c1'], null).cards[0].parent).toBeUndefined()
  })
  it('names the cards that landed on the open board, so they can be picked', () => {
    const out = paste(['concepts', 'n3'], null)
    const top = out.cards.filter(c => out.top.includes(c.id))
    expect(top.map(c => c.kind).sort()).toEqual(['board', 'note'])
  })
  it('joins a copied line to the copies, not the originals', () => {
    const out = paste(['n1', 'n2'], null)
    const line = out.cards.find(c => c.kind === 'arrow')!
    const by = (text: string) => out.cards.find(c => c.text === text)!.id
    expect([line.from, line.to]).toEqual([by('n1'), by('n2')])
  })
  it('a copied board keeps what is inside it, inside the copy, where it was', () => {
    const out = paste(['concepts'], null)
    const board = out.cards.find(c => c.kind === 'board' && c.name === 'concepts')!
    const c1 = out.cards.find(c => c.text === 'c1')!
    const day2 = out.cards.find(c => c.name === 'day2')!
    const d1 = out.cards.find(c => c.text === 'd1')!
    expect(c1.parent).toBe(board.id)
    expect(day2.parent).toBe(board.id)
    expect(d1.parent).toBe(day2.id)
    expect([d1.x, d1.y]).toEqual([40, 40])
    const line = out.cards.find(c => c.kind === 'arrow')!
    expect([line.from, line.to, line.parent]).toEqual([c1.id, day2.id, board.id])
  })
  it('a card copied with its column stays in the copied column', () => {
    const out = paste(['concepts'], null)
    const col = out.cards.find(c => c.kind === 'column')!
    expect(out.cards.find(c => c.text === 'k1')!.col).toBe(col.id)
  })
  it('a card copied without its column lands loose on the board', () => {
    const k1 = paste(['k1'], null).cards[0]
    expect(k1.col).toBeUndefined()
    expect(k1.ord).toBeUndefined()
    expect([k1.x, k1.y]).toEqual([1000, 2000])
  })
  it('moves a line drawn on its own with the group', () => {
    const free: CanvasCard = { id: 'f', kind: 'arrow', x: 0, y: 0, w: 240, z: 0, line: { fx: 10, fy: 20, tx: 90, ty: 60 } }
    const out = pasteCards([free], { parent: null, at: { x: 110, y: 220 }, z: 0, mint })
    expect(out.cards[0].line).toMatchObject({ fx: 110, fy: 220, tx: 190, ty: 260 })
  })
  it('sits above what is already on the board, in the order it was stacked', () => {
    const out = pasteCards([note('lo', 0, 0, { z: 3 }), note('hi', 0, 0, { z: 9 })], { parent: null, at: { x: 0, y: 0 }, z: 50, mint })
    const z = (text: string) => out.cards.find(c => c.text === text)!.z
    expect(z('lo')).toBeGreaterThan(50)
    expect(z('hi')).toBeGreaterThan(z('lo'))
  })
  it('survives the server\'s own rules: nothing pasted is pruned', () => {
    const out = paste(['concepts', 'n1', 'n2'], 'day2')
    const saved = applyCanvasOp(brief, { upsert: out.cards })
    expect(saved).toHaveLength(brief.length + out.cards.length)
  })
})

describe('the clipboard', () => {
  it('reads back what it wrote', () => {
    const copied = cardsToCopy(brief, ['concepts'])
    const back = readCopied(writeCopied(copied, '/dashboard/production/shoots/1#'))
    expect(back?.from).toBe('/dashboard/production/shoots/1#')
    expect(ids(back!.cards)).toEqual(ids(copied))
  })
  it('is nothing when the clipboard holds something else', () => {
    expect(readCopied('')).toBeNull()
    expect(readCopied('hello')).toBeNull()
    expect(readCopied('{"a":1}')).toBeNull()
    expect(readCopied(JSON.stringify({ mdm: 'canvas-cards', v: 1, from: '', cards: [] }))).toBeNull()
  })
  it('drops anything that is not a card', () => {
    const raw = JSON.stringify({ mdm: 'canvas-cards', v: 1, from: '', cards: [note('ok', 0, 0), { id: 'bad', kind: 'virus', x: 0, y: 0 }] })
    expect(readCopied(raw)!.cards.map(c => c.id)).toEqual(['ok'])
  })
  it('gives other apps the words on the cards', () => {
    expect(copiedWords([note('n1', 0, 0, { text: 'Golden hour' }), tile('b', 0, 0, { name: 'Models' }), join('a', 'n1', 'b')]))
      .toBe('Golden hour\nModels')
  })
})

describe('room on the board', () => {
  it('a paste fits while the board stays within its limit', () => {
    expect(pasteFits(10, 5)).toBe(true)
    expect(pasteFits(CANVAS_MAX_CARDS - 5, 5)).toBe(true)
    expect(pasteFits(CANVAS_MAX_CARDS - 4, 5)).toBe(false)
  })
})
