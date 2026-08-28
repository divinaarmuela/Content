import { describe, it, expect } from 'vitest'
import {
  addNextLabel, groupCard, groupLine, nextPieceTitle, splitByGroup,
  type DeliverableGroup,
} from '../app/lib/deliverable-group-core'
import type { ItemStatus } from '../app/lib/workflow-core'

const g = (over: Partial<DeliverableGroup> = {}): DeliverableGroup => ({
  id: 'g1', client_id: 'c1', content_type: 'reel', title: 'October reels', target: 5, ...over,
})
const item = (id: string, status: ItemStatus, group_id: string | null = 'g1') =>
  ({ id, status, group_id })

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
