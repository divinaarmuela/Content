import { describe, expect, it } from 'vitest'
import { GATE_TONE, cardTone, kindTone, todayKey } from '@/app/dashboard/ui/tone'
import { approvalChip } from '@/app/lib/posting-approval-core'

/**
 * The three boards used to carry three hand-copied versions of this map, and
 * they had already drifted. This pins the one map they now share, so a change
 * to what a colour MEANS has to be a deliberate edit here rather than a
 * silent divergence on one page.
 */

const TODAY = '2026-09-03'

describe('cardTone', () => {
  it('is ink when the work is live', () => {
    expect(cardTone({ status: 'published', today: TODAY })).toBe('ink')
  })

  it('is red when the client asked for changes — on every board', () => {
    expect(cardTone({ status: 'client_changes_requested', today: TODAY })).toBe('red')
    expect(cardTone({ status: 'scheduled', changesRequested: true, today: TODAY })).toBe('red')
  })

  it('is red when a post failed', () => {
    expect(cardTone({ status: 'scheduled', failed: true, today: TODAY })).toBe('red')
  })

  it('is amber when the date has arrived, and stays amber once it is past', () => {
    expect(cardTone({ status: 'draft_uploaded', due: TODAY, today: TODAY })).toBe('amber')
    expect(cardTone({ status: 'draft_uploaded', due: '2026-08-30', today: TODAY })).toBe('amber')
    expect(cardTone({ status: 'draft_uploaded', due: '2026-09-04', today: TODAY })).toBeUndefined()
  })

  it('reads an ISO timestamp as its date part', () => {
    expect(cardTone({ status: 'draft_uploaded', due: '2026-09-03T23:30:00Z', today: TODAY })).toBe('amber')
  })

  it('is green when approved and blue when scheduled', () => {
    expect(cardTone({ status: 'approved_for_scheduling', today: TODAY })).toBe('green')
    expect(cardTone({ status: 'scheduled', today: TODAY })).toBe('blue')
  })

  it('is the plain surface card for everything else', () => {
    for (const status of ['draft_uploaded', 'internal_review', 'revision_required', 'revision_complete', 'client_review']) {
      expect(cardTone({ status, today: TODAY }), status).toBeUndefined()
    }
  })

  it('ranks loudest first: live over changes over due over approved over scheduled', () => {
    expect(cardTone({ status: 'published', due: '2026-01-01', changesRequested: true, today: TODAY })).toBe('ink')
    expect(cardTone({ status: 'approved_for_scheduling', due: '2026-01-01', changesRequested: true, today: TODAY })).toBe('red')
    expect(cardTone({ status: 'approved_for_scheduling', due: '2026-01-01', today: TODAY })).toBe('amber')
    expect(cardTone({ status: 'scheduled', due: '2026-12-01', today: TODAY })).toBe('blue')
  })

  it('defaults `today` to the reader’s own date', () => {
    const key = todayKey()
    expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(cardTone({ status: 'draft_uploaded', due: key })).toBe('amber')
  })
})

describe('todayKey', () => {
  it('is the local calendar date, zero-padded', () => {
    expect(todayKey(new Date(2026, 8, 3))).toBe('2026-09-03')
    expect(todayKey(new Date(2026, 0, 9))).toBe('2026-01-09')
  })
})

describe('kindTone', () => {
  it('folds eight stored colours onto the five the palette has', () => {
    expect(kindTone('zinc')).toBe('muted')
    expect(kindTone('pink')).toBe('red')
    expect(kindTone('rose')).toBe('red')
    expect(kindTone('sky')).toBe('blue')
    expect(kindTone('indigo')).toBe('blue')
    expect(kindTone('violet')).toBe('blue')
    expect(kindTone('emerald')).toBe('green')
    expect(kindTone('amber')).toBe('amber')
  })

  it('falls back to muted for an unknown or missing colour', () => {
    expect(kindTone('chartreuse')).toBe('muted')
    expect(kindTone(null)).toBe('muted')
    expect(kindTone(undefined)).toBe('muted')
  })
})

describe('GATE_TONE', () => {
  it('has a tone for every gate state approvalChip can return, and no dead keys', () => {
    const produced = new Set(
      ['pending', 'approved', 'changes', 'nonsense', null, undefined]
        .map(s => approvalChip(s)?.tone)
        .filter((t): t is 'waiting' | 'approved' | 'changes' => !!t),
    )
    expect([...produced].sort()).toEqual(['approved', 'changes', 'waiting'])
    expect(Object.keys(GATE_TONE).sort()).toEqual(['approved', 'changes', 'waiting'])
  })

  it('says waiting in blue, approved in green and changes in red', () => {
    expect(GATE_TONE.waiting).toBe('blue')
    expect(GATE_TONE.approved).toBe('green')
    // the same red the Editor board uses for "client changes" — one fact, one colour
    expect(GATE_TONE.changes).toBe('red')
  })
})
