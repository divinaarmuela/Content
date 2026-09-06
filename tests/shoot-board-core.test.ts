import { describe, expect, it } from 'vitest'
import {
  boardTrail, childrenOf, deleteWarning, descendantsOf, insideLabel, insideOf, pruneOrphans, stillThere,
} from '../app/lib/shoot-board-core'
import { applyCanvasOp, sanitiseCanvasCards } from '../app/lib/batch-brief-core'

/**
 * Boards inside a shoot's board. One flat array; a tile is a card of kind
 * `board`; what is inside it points at it by `parent`. The Milanote shape —
 * "Models · 39 cards", open it, breadcrumbs back — on the shoot's own cards.
 */

const tile = (id: string, name: string, parent?: string) => ({ id, kind: 'board', name, ...(parent ? { parent } : {}) })
const note = (id: string, parent?: string) => ({ id, kind: 'note', ...(parent ? { parent } : {}) })
const arrow = (id: string, parent?: string) => ({ id, kind: 'arrow', ...(parent ? { parent } : {}) })

// Golf Day: Models, Prop list, Concepts on the top board; Concepts holds
// two notes and a board "Day two" which holds one note
const golf = [
  tile('models', 'Models'), tile('props', 'Prop list'), tile('concepts', 'Concepts'),
  note('n1'), note('c1', 'concepts'), note('c2', 'concepts'), arrow('a1', 'concepts'),
  tile('day2', 'Day two', 'concepts'), note('d1', 'day2'),
]

describe('what a board shows', () => {
  it('the top board is the cards with no parent', () => {
    expect(childrenOf(golf, null).map(c => c.id)).toEqual(['models', 'props', 'concepts', 'n1'])
  })
  it('an open board is the cards that point at it, one level down', () => {
    expect(childrenOf(golf, 'concepts').map(c => c.id)).toEqual(['c1', 'c2', 'a1', 'day2'])
    expect(childrenOf(golf, 'day2').map(c => c.id)).toEqual(['d1'])
  })
})

describe('the count under a tile', () => {
  it('counts cards and boards one level down, and arrows are not cards', () => {
    expect(insideOf(golf, 'concepts')).toEqual({ cards: 2, boards: 1 })
    expect(insideLabel(golf, 'concepts')).toBe('2 cards · 1 board')
    expect(insideLabel(golf, 'day2')).toBe('1 card')
    expect(insideLabel(golf, 'models')).toBe('Empty')
  })
})

describe('breadcrumbs', () => {
  it('always start at the shoot, then nest to any depth', () => {
    expect(boardTrail(golf, null).map(c => c.name)).toEqual(['Shoot brief'])
    expect(boardTrail(golf, 'concepts').map(c => c.name)).toEqual(['Shoot brief', 'Concepts'])
    expect(boardTrail(golf, 'day2')).toEqual([
      { id: null, name: 'Shoot brief' }, { id: 'concepts', name: 'Concepts' }, { id: 'day2', name: 'Day two' },
    ])
  })
  it('an unknown board is just the shoot — never a crash', () => {
    expect(boardTrail(golf, 'nope').map(c => c.name)).toEqual(['Shoot brief'])
  })
  it('a cycle in the data stops the walk', () => {
    const loop = [tile('a', 'A', 'b'), tile('b', 'B', 'a')]
    expect(boardTrail(loop, 'a').length).toBeLessThanOrEqual(3)
  })
})

describe('deleting a tile', () => {
  it('takes everything inside it, to any depth', () => {
    expect(descendantsOf(golf, 'concepts').sort()).toEqual(['a1', 'c1', 'c2', 'd1', 'day2'])
    expect(descendantsOf(golf, 'models')).toEqual([])
  })
  it('asks first and says what will go; an empty tile needs no question', () => {
    expect(deleteWarning(golf, golf[2])).toBe('Everything inside “Concepts” goes with it: 3 cards · 1 board.')
    expect(deleteWarning(golf, tile('day2', 'Day two', 'concepts'))).toBe('Everything inside “Day two” goes with it: 1 card.')
    expect(deleteWarning(golf, golf[0])).toBeNull()
    expect(deleteWarning(golf, note('n1'))).toBeNull()
  })
  it('the server cascades whatever the client sent: a removed tile leaves no orphans', () => {
    const next = applyCanvasOp(withGeometry(golf), { remove: ['concepts'] })
    expect(next.map(c => c.id).sort()).toEqual(['models', 'n1', 'props'])
  })
  it('pruneOrphans keeps top-level cards, drops cards under a missing or non-board parent, survives cycles', () => {
    const kept = pruneOrphans([note('x'), note('y', 'gone'), note('z', 'x'), tile('a', 'A', 'b'), tile('b', 'B', 'a')])
    expect(kept.map(c => c.id)).toEqual(['x'])
  })
  it('where to stand once the cards change', () => {
    expect(stillThere(golf, 'day2')).toBe('day2')
    expect(stillThere(golf.filter(c => c.id !== 'day2'), 'day2')).toBeNull()
    expect(stillThere(golf, null)).toBeNull()
  })
})

describe('the tile on the wire', () => {
  it('sanitises a board card: name, a palette colour, a known icon, its parent', () => {
    const [t] = sanitiseCanvasCards([{
      id: 'b1', kind: 'board', x: 0, y: 0, name: '  Concepts  ', icon: 'lightbulb', colour: 'amber', parent: 'top',
    }])
    expect(t).toMatchObject({ kind: 'board', name: 'Concepts', icon: 'lightbulb', colour: 'amber', parent: 'top' })
  })
  it('a made-up colour or icon falls back to the palette; a blank name is "Board"; no free colour picker', () => {
    const [t] = sanitiseCanvasCards([{ id: 'b1', kind: 'board', x: 0, y: 0, name: '', icon: '<img>', colour: '#ff0000' }])
    expect(t).toMatchObject({ name: 'Board', icon: 'folder', colour: 'blue' })
  })
  it('a card can never be its own parent', () => {
    const [t] = sanitiseCanvasCards([{ id: 'b1', kind: 'board', x: 0, y: 0, name: 'Loop', parent: 'b1' }])
    expect(t.parent).toBeUndefined()
  })
  it('the same tile, created by two people at once, is one tile with one set of children', () => {
    // no claim needed: a board IS its tile card, and creation is one per-card
    // upsert; both writers' children point at the same id and both survive
    const base = applyCanvasOp([], { upsert: withGeometry([tile('concepts', 'Concepts')]) })
    const a = applyCanvasOp(base, { upsert: withGeometry([note('c1', 'concepts')]) })
    const b = applyCanvasOp(a, { upsert: withGeometry([note('c2', 'concepts')]) })
    expect(insideLabel(b, 'concepts')).toBe('2 cards')
    expect(b.filter(c => c.kind === 'board')).toHaveLength(1)
  })
})

/** the sanitiser needs x/y on every card — the pure tests above do not */
function withGeometry<T extends { id: string }>(cards: readonly T[]) {
  return cards.map((c, i) => ({ x: i * 10, y: 0, ...c }))
}
