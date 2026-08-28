import { describe, it, expect } from 'vitest'
import {
  addNextLabel, addTypeLabel, formatBreakdown, formatChip, groupCard, groupLine,
  isMixedGroup, mixedGroupLine, nextPieceTitle, plannedFormats, plannedSummary,
  plannedTarget, pluralType, remainingTypes, splitByGroup,
  type DeliverableGroup,
} from '../app/lib/deliverable-group-core'
import type { ItemStatus } from '../app/lib/workflow-core'

const g = (over: Partial<DeliverableGroup> = {}): DeliverableGroup => ({
  id: 'g1', client_id: 'c1', content_type: 'reel', title: 'October reels', target: 5, ...over,
})
const item = (id: string, status: ItemStatus, group_id: string | null = 'g1') =>
  ({ id, status, group_id })
/** a piece that also carries its own format — what a mixed card counts by */
const typed = (id: string, content_type: string, status: ItemStatus = 'draft_uploaded', group_id: string | null = 'g1') =>
  ({ id, status, group_id, content_type })

describe('splitByGroup — quota cards vs plain cards', () => {
  it('folds a group\'s pieces into ONE card and leaves the rest alone', () => {
    const groups = [g()]
    const items = [
      item('a', 'draft_uploaded'),
      item('b', 'internal_review'),
      item('c', 'draft_uploaded', null),
    ]
    const { groupCards, plainItems } = splitByGroup(items, groups)
    expect(groupCards).toHaveLength(1)
    expect(groupCards[0].count).toBe(2)
    expect(groupCards[0].target).toBe(5)
    expect(plainItems.map(i => i.id)).toEqual(['c'])
  })

  it('a group with no pieces yet still gets its card — "0 of 5"', () => {
    const { groupCards } = splitByGroup([], [g()])
    expect(groupCards).toHaveLength(1)
    expect(groupCards[0].count).toBe(0)
    expect(groupCards[0].full).toBe(false)
    // nothing has begun, so the card sits at the very start
    expect(groupCards[0].laneStatus).toBe('draft_uploaded')
  })

  it('target 1 is a plain promise: its items render as ordinary cards, no group card', () => {
    const groups = [g({ target: 1 })]
    const items = [item('a', 'draft_uploaded')]
    const { groupCards, plainItems } = splitByGroup(items, groups)
    expect(groupCards).toHaveLength(0)
    expect(plainItems.map(i => i.id)).toEqual(['a'])
  })

  it('an item pointing at a group this list does not hold falls back to a plain card', () => {
    const { groupCards, plainItems } = splitByGroup([item('a', 'draft_uploaded', 'gone')], [g()])
    expect(plainItems.map(i => i.id)).toEqual(['a'])
    expect(groupCards[0].count).toBe(0)
  })
})

describe('groupCard — where the card sits and what it says', () => {
  it('sits in the lane of the LEAST advanced open piece — the work still owed', () => {
    const card = groupCard(g(), [
      item('a', 'published'),
      item('b', 'internal_review'),
      item('c', 'approved_for_scheduling'),
    ])
    expect(card.laneStatus).toBe('internal_review')
  })

  it('with every piece published, the card reads from the pieces it has', () => {
    const card = groupCard(g({ target: 2 }), [item('a', 'published'), item('b', 'published')])
    expect(card.laneStatus).toBe('published')
    expect(card.full).toBe(true)
  })

  it('fills as pieces are added: 2 of 5, then full at 5', () => {
    const two = groupCard(g(), [item('a', 'draft_uploaded'), item('b', 'draft_uploaded')])
    expect(groupLine(two)).toBe('October reels · 2 of 5')
    expect(two.full).toBe(false)
    const five = groupCard(g(), ['a', 'b', 'c', 'd', 'e'].map(id => item(id, 'draft_uploaded')))
    expect(five.full).toBe(true)
  })
})

describe('the words on the card', () => {
  it('numbers the next piece from how many exist', () => {
    expect(nextPieceTitle(g(), 0)).toBe('October reels 01')
    expect(nextPieceTitle(g(), 2)).toBe('October reels 03')
  })

  it('says the type\'s own word, with a plain fallback', () => {
    expect(addNextLabel(g())).toBe('Add the next reel')
    expect(addNextLabel(g({ content_type: 'carousel' }))).toBe('Add the next carousel')
    expect(addNextLabel(g({ content_type: 'other' }))).toBe('Add the next piece')
  })
})

// ─────────────────────────── mixed-format groups ───────────────────────────

const mix = (over: Partial<DeliverableGroup> = {}): DeliverableGroup => g({
  content_type: 'reel', title: 'October mix', target: 6,
  planned: [{ type: 'reel', qty: 2 }, { type: 'carousel', qty: 2 }, { type: 'video', qty: 2 }],
  ...over,
})

describe('plannedFormats — cleaning the raw list', () => {
  it('null / empty / non-array degrade to null (single-format, as today)', () => {
    expect(plannedFormats({ planned: null })).toBeNull()
    expect(plannedFormats({ planned: undefined })).toBeNull()
    expect(plannedFormats({ planned: [] })).toBeNull()
    // a malformed value that survived a bad migration must not throw
    expect(plannedFormats({ planned: 'nonsense' as unknown as null })).toBeNull()
  })

  it('drops junk rows and merges duplicate types', () => {
    expect(plannedFormats({ planned: [
      { type: 'reel', qty: 2 }, { type: 'reel', qty: 1 },
      { type: '', qty: 3 }, { type: 'carousel', qty: 0 }, { type: 'video', qty: 2 },
    ] })).toEqual([{ type: 'reel', qty: 3 }, { type: 'video', qty: 2 }])
  })

  it('plannedTarget sums the quantities', () => {
    expect(plannedTarget([{ type: 'reel', qty: 2 }, { type: 'video', qty: 2 }])).toBe(4)
  })
})

describe('isMixedGroup — one format is not a mix', () => {
  it('true only with more than one distinct format', () => {
    expect(isMixedGroup(mix())).toBe(true)
    expect(isMixedGroup(g())).toBe(false)                                  // null planned
    expect(isMixedGroup(g({ planned: [{ type: 'reel', qty: 3 }] }))).toBe(false)  // single row
    expect(isMixedGroup(g({ planned: [{ type: 'reel', qty: 1 }, { type: 'reel', qty: 2 }] }))).toBe(false) // merges to one
  })
})

describe('formatBreakdown — per-format progress', () => {
  it('null planned collapses to one row from content_type + count', () => {
    expect(formatBreakdown(g({ target: 5 }), [item('a', 'draft_uploaded'), item('b', 'draft_uploaded')]))
      .toEqual([{ type: 'reel', done: 2, target: 5 }])
  })

  it('partial fill counts each type by the piece\'s own content_type', () => {
    const items = [typed('a', 'reel'), typed('b', 'reel'), typed('c', 'carousel')]
    expect(formatBreakdown(mix(), items)).toEqual([
      { type: 'reel', done: 2, target: 2 },
      { type: 'carousel', done: 1, target: 2 },
      { type: 'video', done: 0, target: 2 },
    ])
  })

  it('over-fill reports the real done, above target', () => {
    const items = [typed('a', 'reel'), typed('b', 'reel'), typed('c', 'reel')]
    expect(formatBreakdown(mix(), items)[0]).toEqual({ type: 'reel', done: 3, target: 2 })
  })

  it('a piece of an unknown type lands in no row', () => {
    const items = [typed('a', 'reel'), typed('b', 'story')]
    const bd = formatBreakdown(mix(), items)
    expect(bd.find(f => f.type === 'reel')?.done).toBe(1)
    expect(bd.map(f => f.type)).toEqual(['reel', 'carousel', 'video'])
  })
})

describe('remainingTypes — only what is still owed', () => {
  it('hides a finished format', () => {
    const items = [typed('a', 'reel'), typed('b', 'reel'), typed('c', 'carousel')]
    expect(remainingTypes(mix(), items)).toEqual(['carousel', 'video'])
  })
  it('a full mix owes nothing', () => {
    const items = [typed('a', 'reel'), typed('b', 'reel'), typed('c', 'carousel'),
      typed('d', 'carousel'), typed('e', 'video'), typed('f', 'video')]
    expect(remainingTypes(mix(), items)).toEqual([])
  })
  it('single-format group owes its one type until full', () => {
    expect(remainingTypes(g({ target: 2 }), [item('a', 'draft_uploaded')])).toEqual(['reel'])
    expect(remainingTypes(g({ target: 2 }), [item('a', 'draft_uploaded'), item('b', 'draft_uploaded')])).toEqual([])
  })
})

describe('the words on a mixed card', () => {
  it('mixedGroupLine reads the whole promise back', () => {
    const items = [typed('a', 'reel'), typed('b', 'reel'), typed('c', 'carousel')]
    expect(mixedGroupLine(mix(), items)).toBe('2 reels, 1 carousel, 0 videos — 3 of 6')
  })
  it('pluralType is singular at one, plural otherwise', () => {
    expect(pluralType('reel', 1)).toBe('reel')
    expect(pluralType('reel', 0)).toBe('reels')
    expect(pluralType('story', 2)).toBe('stories')
    expect(pluralType('widget', 2)).toBe('widgets')
  })
  it('formatChip labels and flags completion', () => {
    expect(formatChip({ type: 'reel', done: 2, target: 2 })).toEqual({ label: 'Reels 2/2', done: true })
    expect(formatChip({ type: 'video', done: 0, target: 2 })).toEqual({ label: 'Videos 0/2', done: false })
  })
  it('addTypeLabel picks the article', () => {
    expect(addTypeLabel('reel')).toBe('Add a reel')
    expect(addTypeLabel('other')).toBe('Add a piece')
  })
  it('plannedSummary is the dialog\'s live line', () => {
    expect(plannedSummary([{ type: 'reel', qty: 2 }, { type: 'carousel', qty: 2 }, { type: 'video', qty: 2 }]))
      .toBe('2 reels, 2 carousels, 2 videos (6 pieces)')
    expect(plannedSummary([{ type: 'reel', qty: 1 }])).toBe('1 reel (1 piece)')
    expect(plannedSummary([])).toBe('')
  })
})
