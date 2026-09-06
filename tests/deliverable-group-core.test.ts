import { describe, it, expect } from 'vitest'
import {
  plannedFormats, plannedTarget,
  contentTypeFromTitle, isLegacyPlan, moveLine, planCardId, planCards, planLines, planSummary,
} from '../app/lib/deliverable-group-core'

// The quota card is gone: a card is one deliverable, and every piece is its
// own card whatever group it was made in. What is left of groups here is the
// API's cleaning of a `planned` list; the rest of the file is the shoot plan.

describe('no quota-card helpers are left', () => {
  it('the module exports nothing that draws or fills a group card', async () => {
    const mod = await import('../app/lib/deliverable-group-core')
    for (const gone of ['splitByGroup', 'groupCard', 'groupLine', 'nextPieceTitle', 'addNextLabel',
      'isTaskGroup', 'mixedGroupLine', 'formatBreakdown', 'remainingTypes', 'statusSpread', 'spreadLine',
      'formatChip', 'addTypeLabel', 'pluralType', 'isMixedGroup']) {
      expect(gone in mod, `${gone} is still exported`).toBe(false)
    }
  })
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

// ───────────────────────────── the shoot plan ─────────────────────────────
// "no more 2 reel 2 graphic" — a plan is plain lines, one line one card.

describe('planLines — the plan as lines, whichever shape it was stored in', () => {
  it('reads new {id, title} rows as written, in order', () => {
    expect(planLines([
      { id: 'a1', title: '  Hero reel ' }, { id: 'b2', title: 'Menu carousel' }, { id: 'c3', title: 'Chef portrait' },
    ])).toEqual([
      { id: 'a1', title: 'Hero reel' }, { id: 'b2', title: 'Menu carousel' }, { id: 'c3', title: 'Chef portrait' },
    ])
  })

  it('reads an OLD {type, qty} plan as numbered lines — "2 reels" is Reel 1 and Reel 2', () => {
    expect(planLines([{ type: 'reel', qty: 2 }, { type: 'carousel', qty: 1 }])).toEqual([
      { id: 'reel-1', title: 'Reel 1' }, { id: 'reel-2', title: 'Reel 2' }, { id: 'carousel-1', title: 'Carousel' },
    ])
  })

  it('numbers a legacy type across the whole plan, and says "image" never "graphic"', () => {
    expect(planLines([{ type: 'reel', qty: 2 }, { type: 'static', qty: 2 }, { type: 'reel', qty: 1 }]).map(l => l.title))
      .toEqual(['Reel 1', 'Reel 2', 'Image 1', 'Image 2', 'Reel 3'])
  })

  it('mixes both shapes, drops junk, and never throws', () => {
    expect(planLines(null)).toEqual([])
    expect(planLines('nonsense')).toEqual([])
    expect(planLines([null, 7, { title: '   ' }, { type: '', qty: 3 }, { type: 'reel', qty: 0 }, { type: 'video', qty: 2.5 }])).toEqual([])
    expect(planLines([{ type: 'reel', qty: 1 }, { title: 'Chef portrait' }])).toEqual([
      { id: 'reel-1', title: 'Reel' }, { id: 'line-2', title: 'Chef portrait' },
    ])
  })

  it('gives a missing id from the row position and makes a repeated id unique', () => {
    expect(planLines([{ title: 'One' }, { id: 'x', title: 'Two' }, { id: 'x', title: 'Three' }]).map(l => l.id))
      .toEqual(['line-1', 'x', 'x-2'])
    // an id is a key: only key-safe characters survive
    expect(planLines([{ id: 'a/b.c#1', title: 'T' }])[0].id).toBe('abc1')
  })

  it('caps a plan at 100 lines and a title at 120 characters', () => {
    expect(planLines([{ type: 'reel', qty: 500 }])).toHaveLength(100)
    expect(planLines([{ title: 'x'.repeat(200) }])[0].title).toHaveLength(120)
  })

  it('isLegacyPlan spots the old shape only', () => {
    expect(isLegacyPlan([{ type: 'reel', qty: 2 }])).toBe(true)
    expect(isLegacyPlan([{ id: 'a', title: 'Hero reel' }])).toBe(false)
    expect(isLegacyPlan([])).toBe(false)
    expect(isLegacyPlan(null)).toBe(false)
  })
})

describe('planSummary — the plan in one sentence', () => {
  it('names the things', () => {
    expect(planSummary([{ id: 'a', title: 'Hero reel' }, { id: 'b', title: 'Menu carousel' }, { id: 'c', title: 'Chef portrait' }]))
      .toBe('3 things from this shoot: Hero reel, Menu carousel, Chef portrait')
    expect(planSummary([{ id: 'a', title: 'Hero reel' }])).toBe('One thing from this shoot: Hero reel')
    expect(planSummary([])).toBe('')
    expect(planSummary([{ id: 'a', title: '   ' }])).toBe('')
  })
  it('names six and counts the rest', () => {
    const lines = Array.from({ length: 8 }, (_, i) => ({ id: `l${i}`, title: `Thing ${i + 1}` }))
    expect(planSummary(lines)).toBe('8 things from this shoot: Thing 1, Thing 2, Thing 3, Thing 4, Thing 5, Thing 6 and 2 more')
  })
})

describe('moveLine — reordering', () => {
  it('moves a line and leaves the rest in order', () => {
    expect(moveLine(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
    expect(moveLine(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c'])
  })
  it('is a no-op out of range', () => {
    const lines = ['a', 'b']
    expect(moveLine(lines, 0, 0)).toBe(lines)
    expect(moveLine(lines, 1, 2)).toBe(lines)
    expect(moveLine(lines, -1, 0)).toBe(lines)
  })
})

describe('planCards — what booking a shoot creates', () => {
  const shoot = { id: '4d2f1c1e-9b4a-4f8c-8a1e-2f3b4c5d6e7f', client_id: 'client-1' }

  it('makes one card per line, in Draft, titled with the line — never one card for several', () => {
    const cards = planCards(shoot, [{ id: 'a', title: 'Hero reel' }, { id: 'b', title: 'Menu carousel' }])
    expect(cards.map(c => c.title)).toEqual(['Hero reel', 'Menu carousel'])
    expect(cards.every(c => c.client_id === 'client-1' && c.batch_id === shoot.id)).toBe(true)
    expect(cards.map(c => c.content_type)).toEqual(['reel', 'carousel'])
  })

  it('an old "2 reels" plan makes two cards, not one card of two', () => {
    const cards = planCards(shoot, [{ type: 'reel', qty: 2 }])
    expect(cards.map(c => c.title)).toEqual(['Reel 1', 'Reel 2'])
    expect(new Set(cards.map(c => c.id)).size).toBe(2)
  })

  it('the card id is fixed by shoot and line, so a repeat cannot double-create', () => {
    const first = planCards(shoot, [{ id: 'a', title: 'Hero reel' }])[0].id
    const again = planCards(shoot, [{ id: 'a', title: 'Hero reel (renamed)' }])[0].id
    expect(again).toBe(first)
    expect(planCardId(shoot.id, 'a')).toBe(first)
    expect(planCardId(shoot.id, 'b')).not.toBe(first)
    expect(planCardId('another-shoot', 'a')).not.toBe(first)
  })

  it('the id is UUID-shaped, because every link in the app checks for one', () => {
    const id = planCardId(shoot.id, 'a')
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(/^[0-9a-f-]{36}$/i.test(id)).toBe(true)
  })

  it('an empty plan makes nothing', () => {
    expect(planCards(shoot, [])).toEqual([])
    expect(planCards(shoot, null)).toEqual([])
  })
})

describe('contentTypeFromTitle — what the line says it is', () => {
  it('reads the obvious words and falls back to other', () => {
    expect(contentTypeFromTitle('Hero reel')).toBe('reel')
    expect(contentTypeFromTitle('Menu carousel')).toBe('carousel')
    expect(contentTypeFromTitle('Opening day stories')).toBe('story')
    expect(contentTypeFromTitle('BTS clip')).toBe('video')
    expect(contentTypeFromTitle('Chef portrait')).toBe('static')
    expect(contentTypeFromTitle('Something else')).toBe('other')
  })
})
