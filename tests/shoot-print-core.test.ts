import { describe, expect, it } from 'vitest'
import { columnBeside, printBlock, printCounts, printSections } from '@/app/lib/shoot-print-core'
import type { CanvasCard } from '@/app/lib/batch-brief-core'

/**
 * THE SHOOT BRIEF, ON PAPER (Renee, 25 Nov 2026). The board below is the Alia event brief's own shape, cut down:
 * a title across the top, BRIEF with a table and a board tile beside it, VID 1 and VID 2 down the left with their
 * reference pictures to the right, VID 5 in a second lane, and INTERVIEWS off to the right with a line before it.
 */

let z = 0
const card = (over: Partial<CanvasCard> & Pick<CanvasCard, 'id' | 'kind' | 'x' | 'y'>): CanvasCard => ({ w: 240, z: z++, ...over } as CanvasCard)
const col = (id: string, name: string, x: number, y: number) => card({ id, kind: 'column', name, x, y, w: 300 })
const note = (id: string, text: string, inCol: string, ord: number) => card({ id, kind: 'note', text, col: inCol, ord, x: 0, y: 0, w: 208 })
const pic = (id: string, x: number, y: number, extra: Partial<CanvasCard> = {}) => card({ id, kind: 'image', url: `https://files.example.test/${id}.png`, x, y, w: 250, h: 290, ...extra })

const BOARD: CanvasCard[] = [
  card({ id: 'title', kind: 'note', text: 'alia at teta\'s table brief', x: -1624, y: -640, w: 5215 }),
  col('brief', 'BRIEF', -1624, -524),
  note('b2', 'DELIVERABLES : x REELS', 'brief', 1),
  note('b1', 'Camera : Martin', 'brief', 0),
  card({ id: 'beats', kind: 'table', x: -1280, y: -524, w: 680, header: true, rows: [['<p>Beat</p>', '<p>Picture</p>'], ['<p>Open</p>', '<p>Tablescape</p>']] }),
  card({ id: 'photos', kind: 'board', name: 'PHOTOS', x: -544, y: -524, w: 176 }),
  pic('ph2', 300, 0, { parent: 'photos' }),
  pic('ph1', 0, 0, { parent: 'photos' }),
  col('vid1', 'VID 1 HERO', -1624, 176),
  note('v1', '**Hero campaign video**', 'vid1', 0),
  card({ id: 'v1post', kind: 'mockup', col: 'vid1', ord: 1, x: 0, y: 0, platform: 'ig_reel', text: 'A reel we like', link_url: 'https://www.instagram.com/reel/abc/', preview: { thumb: 'https://cdn.example.test/t.jpg', author: '@someone' } as never }),
  pic('a3', -1012, 480),
  pic('a1', -1280, 176),
  pic('a2', -1016, 176),
  col('vid2', 'VID 2', -1624, 1808),
  note('v2', 'Second video', 'vid2', 0),
  pic('c1', -564, 1796), // starts a hair above VID 2's top: still VID 2's
  col('vid5', 'VID 5', -176, 175),
  note('v5', 'Fifth video', 'vid5', 0),
  pic('e1', 144, 176),
  col('int', 'INTERVIEWS', 1616, 112),
  note('i1', 'Question one', 'int', 0),
  card({ id: 'pre', kind: 'note', text: 'Each video mixes on-brand questions', x: 1376, y: 112, w: 208 }),
  card({ id: 'arrow', kind: 'arrow', x: 0, y: 0, line: { fx: 0, fy: 0, tx: 10, ty: 10 } }),
]

describe('a loose card goes with the column it sits beside', () => {
  const columns = BOARD.filter(c => c.kind === 'column')
  const beside = (id: string) => { const at = columnBeside(BOARD.find(c => c.id === id)!, columns); return at ? `${at.column.id}:${at.side}` : null }
  it('a picture to the right of a column, level with it, is that column\'s', () => {
    expect(beside('a1')).toBe('vid1:left')
    expect(beside('a3')).toBe('vid1:left')
  })
  it('the next column down the same lane takes over from its own top', () => {
    expect(beside('c1')).toBe('vid2:left')
  })
  it('a second lane has its own pictures', () => {
    expect(beside('e1')).toBe('vid5:left')
  })
  it('a note hard up against a column on its right opens that column, not the far one on its left', () => {
    expect(beside('pre')).toBe('int:right')
  })
  it('what sits above every column belongs to none', () => {
    expect(beside('title')).toBeNull()
  })
})

describe('the board, read into sections', () => {
  const sections = printSections(BOARD, 'Alia event')
  const titles = sections.map(s => s.title)
  const by = (title: string) => sections.find(s => s.title === title)!
  const idsOf = (list: { id: string }[]) => list.map(b => b.id)

  it('opens with what sits beside no column, then each column down its lane, lanes left to right, a board tile after its column', () => {
    expect(titles).toEqual(['Alia event', 'BRIEF', 'PHOTOS', 'VID 1 HERO', 'VID 2', 'VID 5', 'INTERVIEWS'])
  })
  it('a column keeps its own order, then what lies beside it; the table is words, not a picture', () => {
    expect(idsOf(by('BRIEF').blocks)).toEqual(['b1', 'b2', 'beats'])
    expect(by('BRIEF').pictures).toEqual([])
  })
  it('a column\'s reference pictures follow its words, left to right then down, with its own post first', () => {
    expect(idsOf(by('VID 1 HERO').blocks)).toEqual(['v1'])
    expect(idsOf(by('VID 1 HERO').pictures)).toEqual(['v1post', 'a1', 'a2', 'a3'])
  })
  it('the line before a column is printed before its cards', () => {
    expect(idsOf(by('INTERVIEWS').blocks)).toEqual(['pre', 'i1'])
  })
  it('a board inside the board is a section one level down, holding its own cards', () => {
    expect(by('PHOTOS').depth).toBe(1)
    expect(idsOf(by('PHOTOS').pictures)).toEqual(['ph1', 'ph2'])
  })
  it('every card that can be printed is printed exactly once, and an arrow is not', () => {
    const printed = sections.flatMap(s => [...s.blocks, ...s.pictures]).map(b => b.id)
    const expected = BOARD.filter(c => !['column', 'board', 'arrow'].includes(c.kind)).map(c => c.id)
    expect([...printed].sort()).toEqual([...expected].sort())
    expect(new Set(printed).size).toBe(printed.length)
  })
  it('counts what the sheet holds', () => {
    expect(printCounts(sections)).toEqual({ sections: 7, pictures: 8 })
  })
})

describe('one card as what is printed', () => {
  it('an empty note prints nothing', () => {
    expect(printBlock(card({ id: 'n', kind: 'note', text: '  ', x: 0, y: 0 }))).toBeNull()
  })
  it('a post keeps its picture, its account, its words and its link', () => {
    expect(printBlock(BOARD.find(c => c.id === 'v1post')!)).toEqual({
      kind: 'post', id: 'v1post', thumb: 'https://cdn.example.test/t.jpg', author: '@someone', words: 'A reel we like',
      link: 'https://www.instagram.com/reel/abc/', platform: 'ig_reel',
    })
  })
  it('a board that points at itself does not loop', () => {
    const loop = [card({ id: 'a', kind: 'board', name: 'A', x: 0, y: 0, parent: 'a' }), pic('p', 0, 0, { parent: 'a' })]
    expect(() => printSections(loop)).not.toThrow()
  })
})

import { picturesReadyLine, printPicture } from '../app/lib/shoot-print-core'

describe('the pictures on the paper', () => {
  // Renee, 26 Nov 2026: "it doesnt save the pics when print" — 94 full-size pictures, 194 MB, never arrived in time
  it('a picture in our own storage is printed from its 1280 small copy', () => {
    const url = 'https://pub-abc.r2.dev/briefs/shot.PNG'
    expect(printPicture(url)).toBe(`/api/img?u=${encodeURIComponent(url)}&w=1280`)
  })
  it('a picture on another site is printed from where it lives', () => {
    expect(printPicture('https://i.pinimg.com/736x/a.jpg')).toBe('https://i.pinimg.com/736x/a.jpg')
  })
  it('the wait says how many pictures have arrived', () => {
    expect(picturesReadyLine(31, 94)).toBe('31 of 94 pictures ready to print…')
    expect(picturesReadyLine(0, 1)).toBe('Getting the picture ready to print…')
    expect(picturesReadyLine(99, 94)).toBe('94 of 94 pictures ready to print…')
  })
})

describe('a column that is only a door to another board', () => {
  // Renee, 26 Nov 2026, the Alia brief: "so like this" (VID 1 with its pictures beside it) — "this is how it looks
  // when printed" (the words and one picture). PHOTOS (SEB), holding only the PHOTOS board's tile, sat nearer the
  // pictures than VID 1 did and took them all into a section of its own.
  const board = [
    col('v1', 'VID 1', -1624, 145),
    card({ id: 'n1', kind: 'note', x: -1624, y: 145, col: 'v1', ord: 0, text: 'The hero script' }),
    col('door', 'PHOTOS (SEB)', -1304, -524),
    card({ id: 'tile', kind: 'board', x: -1290, y: -524, col: 'door', ord: 0, name: 'PHOTOS' }),
    card({ id: 'inner', kind: 'image', x: 0, y: 0, parent: 'tile', url: 'https://x/inner.jpg' }),
    card({ id: 'p1', kind: 'image', x: -1280, y: 176, url: 'https://x/1.jpg' }),
    card({ id: 'p2', kind: 'image', x: -760, y: 500, url: 'https://x/2.jpg' }),
  ]
  it('takes no loose pictures: they go with the script they sit beside', () => {
    const sections = printSections(board)
    expect(sections.find(s => s.title === 'VID 1')?.pictures.map(p => p.id)).toEqual(['p1', 'p2'])
    expect(sections.some(s => s.title === 'PHOTOS (SEB)')).toBe(false)
  })
  it('the board behind the tile is still printed, as its own section', () => {
    expect(printSections(board).find(s => s.title === 'PHOTOS')?.pictures.map(p => p.id)).toEqual(['inner'])
  })
})
