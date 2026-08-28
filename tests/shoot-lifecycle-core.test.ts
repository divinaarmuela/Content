import { describe, it, expect } from 'vitest'
import {
  SHOWN_SHOOT_LABEL, shouldAutoWrap, shownShootState,
} from '../app/lib/shoot-lifecycle-core'

const TODAY = new Date('2026-08-28T10:00:00Z')

describe('shownShootState — the calendar says "shot", not a button', () => {
  it('a locked shoot whose date has passed reads as Shot', () => {
    expect(shownShootState({ status: 'locked', shoot_date: '2026-08-27' }, TODAY)).toBe('shot')
  })

  it('a locked shoot today or in the future is Booked — the crew may be mid-shoot', () => {
    expect(shownShootState({ status: 'locked', shoot_date: '2026-08-28' }, TODAY)).toBe('booked')
    expect(shownShootState({ status: 'locked', shoot_date: '2026-09-10' }, TODAY)).toBe('booked')
  })

  it('a locked shoot with no date is still just Booked', () => {
    expect(shownShootState({ status: 'locked', shoot_date: null }, TODAY)).toBe('booked')
  })

  it('the stored statuses keep their word', () => {
    expect(shownShootState({ status: 'brief', shoot_date: '2026-08-01' }, TODAY)).toBe('planning')
    expect(shownShootState({ status: 'shot', shoot_date: null }, TODAY)).toBe('shot')
    expect(shownShootState({ status: 'wrapped', shoot_date: '2026-08-01' }, TODAY)).toBe('closed')
  })

  it('every state has words', () => {
    for (const s of ['planning', 'booked', 'shot', 'closed'] as const) {
      expect(SHOWN_SHOOT_LABEL[s]).toBeTruthy()
    }
  })
})

describe('shouldAutoWrap — a shoot closes itself when its work is done', () => {
  const plan = { status: 'scheduled', work_kinds: { slug: 'shoot_brief' } }
  const pub = { status: 'published', work_kinds: { slug: 'edit' } }
  const open = { status: 'internal_review', work_kinds: { slug: 'edit' } }

  it('wraps once every produced piece is published — the plan never counts', () => {
    expect(shouldAutoWrap('shot', [plan, pub, pub])).toBe(true)
    expect(shouldAutoWrap('locked', [pub])).toBe(true)
  })

  it('never wraps with work still open', () => {
    expect(shouldAutoWrap('shot', [pub, open])).toBe(false)
  })

  it('never wraps a shoot that produced nothing — its items may still be coming', () => {
    expect(shouldAutoWrap('shot', [])).toBe(false)
    expect(shouldAutoWrap('shot', [plan])).toBe(false)
  })

  it('never touches a shoot still in planning, or one already closed', () => {
    expect(shouldAutoWrap('brief', [pub])).toBe(false)
    expect(shouldAutoWrap('wrapped', [pub])).toBe(false)
  })
})
