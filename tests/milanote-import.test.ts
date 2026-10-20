import { describe, expect, it } from 'vitest'
import { BOARD_TILE_W, convertTree, kidsIndex, lineOf, mnHex, mnWidth, nearestCard, sameClient, type MnElement } from '../app/lib/milanote-import-core'
import { sanitiseCanvasCards } from '../app/lib/batch-brief-core'

const el = (e: Partial<MnElement> & { _id: string; elementType: string }): MnElement => e as MnElement
const tree = (els: MnElement[]) => {
  const elements = Object.fromEntries(els.map(e => [e._id, e]))
  return { elements, kids: kidsIndex(elements), media: new Map<string, string>(), boardTarget: new Map<string, string>() }
}
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

describe('Milanote → our boards (20 Oct 2026)', () => {
  it("Milanote's sizes, measured on screen: 9 px a unit, width × 9 − 2, no width = 34 units", () => {
    expect(mnWidth(101)).toBe(907)
    expect(mnWidth(49)).toBe(439)
    expect(mnWidth(undefined)).toBe(304)
  })

  it('every way Milanote says a colour', () => {
    expect(mnHex('#EB728F')).toBe('#eb728f')
    expect(mnHex('ORANGE')).toBe('#f6b26b')
    expect(mnHex({ value: '#df1e03' })).toBe('#df1e03')
    expect(mnHex({ color: 'GREY' })).toBe('#d9d9d9')
    expect(mnHex('nonsense')).toBeUndefined()
  })

  it("a board's notes, columns with their cards in order, and a child board's contents inside its tile", () => {
    const t = tree([
      el({ _id: 'root', elementType: 'BOARD', content: { title: 'Luxe' } }),
      el({ _id: 'n1', elementType: 'CARD', location: { parentId: 'root', section: 'CANVAS', position: { x: 10, y: 2 } }, content: { textContent: doc('Shoot day'), width: 49 } }),
      el({ _id: 'c1', elementType: 'COLUMN', location: { parentId: 'root', section: 'CANVAS', position: { x: 50, y: 0 } }, content: { title: 'Staff concepts', background: { color: 'PINK' } } }),
      el({ _id: 'k2', elementType: 'CARD', location: { parentId: 'c1', section: 'INBOX', position: { score: 20 } }, content: { textContent: doc('second') } }),
      el({ _id: 'k1', elementType: 'CARD', location: { parentId: 'c1', section: 'INBOX', position: { score: 10 } }, content: { textContent: doc('first') } }),
      el({ _id: 'b1', elementType: 'BOARD', location: { parentId: 'root', section: 'CANVAS', position: { x: 0, y: 40 } }, content: { title: 'Shoot 2', color: '#fd4e7a', icon: { png: 'https://static.milanote.com/element-icons/png/48x48/2.png' } } }),
      el({ _id: 'in', elementType: 'CARD', location: { parentId: 'b1', section: 'CANVAS', position: { x: 1, y: 1 } }, content: { textContent: doc('inside') } }),
    ])
    const r = convertTree('root', t)
    const by = (id: string) => r.cards.find(c => c.id === id)!
    expect(by('n1')).toMatchObject({ kind: 'note', x: 90, y: 18, w: 439, mn: 'n1', text: 'Shoot day' })
    expect(by('c1')).toMatchObject({ kind: 'column', name: 'Staff concepts', hex: '#f4a6c1' })
    expect([by('k1').ord, by('k2').ord]).toEqual([0, 1])
    expect(by('k1').col).toBe('c1')
    expect(by('b1')).toMatchObject({ kind: 'board', name: 'Shoot 2', w: BOARD_TILE_W, hex: '#fd4e7a' })
    expect(by('b1').icon_url).toContain('static.milanote.com')
    expect(by('in').parent).toBe('b1')
    // everything passes the board's own checker
    expect(sanitiseCanvasCards(r.cards)).toHaveLength(r.cards.length)
  })

  it('a board that is its own team board elsewhere is a link to it, not a copy', () => {
    const t = tree([
      el({ _id: 'root', elementType: 'BOARD', content: { title: 'MD Media' } }),
      el({ _id: 'cl', elementType: 'BOARD', location: { parentId: 'root', section: 'CANVAS', position: { x: 0, y: 0 } }, content: { title: 'Basfoods' } }),
      el({ _id: 'deep', elementType: 'CARD', location: { parentId: 'cl', section: 'CANVAS', position: { x: 0, y: 0 } }, content: { textContent: doc('x') } }),
    ])
    const r = convertTree('root', { ...t, boardTarget: new Map([['cl', 'team-board-basfoods']]) })
    expect(r.cards.map(c => [c.id, c.kind, c.target])).toEqual([['cl', 'boardlink', 'team-board-basfoods']])
  })

  it('task lists keep their ticks; a comment pinned to a note comes with that note', () => {
    const t = tree([
      el({ _id: 'root', elementType: 'BOARD', content: {} }),
      el({ _id: 'tl', elementType: 'TASK_LIST', location: { parentId: 'root', section: 'CANVAS', position: { x: 0, y: 0 } }, content: { title: 'Checks', showTitle: true } }),
      el({ _id: 't1', elementType: 'TASK', location: { parentId: 'tl', section: 'INBOX', position: { score: 1 } }, content: { textContent: doc('FILMED'), isComplete: true } }),
      el({ _id: 'n', elementType: 'CARD', location: { parentId: 'root', section: 'CANVAS', position: { x: 30, y: 0 } }, content: { textContent: doc('pillars') } }),
      el({ _id: 'th', elementType: 'COMMENT_THREAD', location: { parentId: 'n', section: 'ATTACHED' }, content: { threadId: 'th' } }),
    ])
    const r = convertTree('root', t)
    expect(r.cards.find(c => c.id === 'tl')).toMatchObject({ kind: 'todo', name: 'Checks', items: [{ id: 't1', text: 'FILMED', done: true }] })
    expect(r.threads).toEqual([{ threadId: 'th', board: null, x: 270, y: 0, card: 'n' }])
  })

  it("a line: joined where Milanote snapped it, its curve, label and ends", () => {
    const elements = { a: el({ _id: 'a', elementType: 'CARD' }) }
    const l = lineOf(el({ _id: 'l', elementType: 'LINE', location: { position: { x: 10, y: 10 } }, content: {
      start: { x: 0, y: 0, elementId: 'a' }, end: { x: 20, y: 0 }, startStyle: 'NONE', endStyle: 'ARROW',
      lineStyle: 'DASHED', lineWeight: 4, lineLabel: 'then', lineLabelEnabled: true, control: { perpMag: 2, parallelRatio: 0.5 },
    } }), { elements })
    expect(l.from).toBe('a')
    expect(l.to).toBeUndefined()
    expect(l.line).toMatchObject({ fx: 90, fy: 90, tx: 270, ty: 90, cx: 180, cy: 108, label: 'then', start: 'none', end: 'arrow', dashed: true, weight: 4 })
  })

  it('a comment with no card of its own goes on the nearest card of its board; client names match loosely', () => {
    const cards = [{ id: 'far', kind: 'note', x: 900, y: 900, w: 200, z: 1 }, { id: 'near', kind: 'note', x: 0, y: 0, w: 200, z: 2 }] as never
    expect(nearestCard(cards, null, 50, 40)).toBe('near')
    expect(sameClient('WATERSIDE', 'Waterside')).toBe(true)
    expect(sameClient('Cecconis', "Cecconi's Toorak & Flinders")).toBe(true)
    expect(sameClient('Lucinda', 'Luxe Laser')).toBe(false)
  })
})
