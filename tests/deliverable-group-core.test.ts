import { describe, it, expect } from 'vitest'
import {
  addNextLabel, addTypeLabel, formatBreakdown, formatChip, groupCard, groupLine,
  isMixedGroup, mixedGroupLine, nextPieceTitle, plannedFormats, plannedSummary,
  plannedTarget, pluralType, remainingTypes, splitByGroup, spreadLine, statusSpread,
  type DeliverableGroup,
} from '../app/lib/deliverable-group-core'
import { STATUS_LABELS, type ItemStatus } from '../app/lib/workflow-core'

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
  it('mixedGroupLine reads the whole PROMISE back, not what happens to exist', () => {
    // built from `done` this said "0 reels, 0 carousels, 0 videos — 0 of 6" on
    // a fresh card: the one sentence the card most needed to say — what we owe
    // this client — was the one it never said until the work was finished
    const items = [typed('a', 'reel'), typed('b', 'reel'), typed('c', 'carousel')]
    expect(mixedGroupLine(mix(), items)).toBe('2 reels, 2 carousels, 2 videos · 3 of 6')
    expect(mixedGroupLine(mix(), [])).toBe('2 reels, 2 carousels, 2 videos · 0 of 6')
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

describe('5 feeds + 2 stories is ONE card, whether or not the files were in hand', () => {
  // The create dialog used to skip the group whenever raw files or a folder
  // link were attached, on the reasoning that the work already existed rather
  // than being promised. Seven cards appeared on the board for one job. The
  // pieces are the same pieces either way; what makes them one card is the
  // group_id they carry, and these are the rules that turn that into a card.
  const mixed = g({
    id: 'g7', content_type: 'feed', title: 'October set', target: 7,
    planned: [{ type: 'feed', qty: 5 }, { type: 'story', qty: 2 }],
  })
  const pieces = [
    ...Array.from({ length: 5 }, (_, i) => typed(`f${i}`, 'feed', 'draft_uploaded', 'g7')),
    ...Array.from({ length: 2 }, (_, i) => typed(`s${i}`, 'story', 'draft_uploaded', 'g7')),
  ]

  it('draws one card holding all seven, not seven cards', () => {
    const { groupCards, plainItems } = splitByGroup(pieces, [mixed])
    expect(groupCards).toHaveLength(1)
    expect(plainItems).toEqual([])
    expect(groupCards[0].count).toBe(7)
    expect(groupCards[0].target).toBe(7)
    expect(groupCards[0].full).toBe(true)
  })

  it('is seven cards again the moment the pieces carry no group — the old behaviour', () => {
    const loose = pieces.map(p => ({ ...p, group_id: null }))
    const { groupCards, plainItems } = splitByGroup(loose, [mixed])
    expect(plainItems).toHaveLength(7)
    expect(groupCards[0].count).toBe(0)
  })

  it('keeps every piece its own item inside the card — one card is not one thing', () => {
    // versions, statuses and reviews are per item; the card only draws them
    // together. If the card collapsed identity, the version chains would have
    // nothing to hang off.
    const [card] = splitByGroup(pieces, [mixed]).groupCards
    expect(new Set(card.items.map(i => i.id)).size).toBe(7)
  })

  it('counts each format against its own promise, not the group total', () => {
    expect(formatBreakdown(mixed, pieces)).toEqual([
      { type: 'feed', done: 5, target: 5 },
      { type: 'story', done: 2, target: 2 },
    ])
  })

  it('still says 5 of 7 while two are outstanding', () => {
    const partial = pieces.slice(0, 5)
    const [card] = splitByGroup(partial, [mixed]).groupCards
    expect(card.count).toBe(5)
    expect(card.full).toBe(false)
    expect(formatBreakdown(mixed, partial)).toEqual([
      { type: 'feed', done: 5, target: 5 },
      { type: 'story', done: 0, target: 2 },
    ])
  })

  it('one piece needing changes does not un-approve the other six', () => {
    // the card's LANE follows the least advanced piece, which is the board's
    // rule — but the pieces themselves keep their own status, and that is what
    // the client review and the version chain read
    const six = pieces.slice(0, 6).map(p => ({ ...p, status: 'approved_for_scheduling' as ItemStatus }))
    const one = { ...pieces[6], status: 'client_changes_requested' as ItemStatus }
    const [card] = splitByGroup([...six, one], [mixed]).groupCards
    expect(card.laneStatus).toBe('client_changes_requested')
    expect(card.items.filter(i => i.status === 'approved_for_scheduling')).toHaveLength(6)
  })
})

describe('a card can be green and stuck at the same time — so it says both', () => {
  // 5 approved + 2 the client wants changed drew a 100% EMERALD bar while
  // sitting in the "Client wants changes" lane: the only card on the board that
  // could read finished and blocked at once. The lane is right — the card is
  // not done until all of it is — so the fix is the card face, not the lane.
  const seven = [
    ...Array.from({ length: 5 }, (_, i) => item(`a${i}`, 'approved_for_scheduling')),
    ...Array.from({ length: 2 }, (_, i) => item(`c${i}`, 'client_changes_requested')),
  ]

  it('counts the pieces per stage, worst first', () => {
    expect(statusSpread(seven)).toEqual([
      { status: 'client_changes_requested', count: 2 },
      { status: 'approved_for_scheduling', count: 5 },
    ])
  })

  it('says it in words the board can print', () => {
    expect(spreadLine(seven, STATUS_LABELS))
      .toBe('2 client wants changes · 5 needs a posting date')
  })

  it('stays quiet when every piece agrees — the lane already said it', () => {
    const allSame = Array.from({ length: 4 }, (_, i) => item(`x${i}`, 'internal_review'))
    expect(spreadLine(allSame, STATUS_LABELS)).toBeNull()
    expect(statusSpread(allSame)).toEqual([{ status: 'internal_review', count: 4 }])
  })

  it('says nothing about an empty card rather than inventing a stage', () => {
    expect(statusSpread([])).toEqual([])
    expect(spreadLine([], STATUS_LABELS)).toBeNull()
  })

  it('leaves the lane exactly as it was — this adds to the card, it does not move it', () => {
    const [card] = splitByGroup(seven.map(i => ({ ...i, group_id: 'g1' })), [g({ target: 7 })]).groupCards
    expect(card.laneStatus).toBe('client_changes_requested')
    expect(card.count).toBe(7)
  })
})
