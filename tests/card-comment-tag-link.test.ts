import { describe, it, expect } from 'vitest'
import { cardPathForRole } from '../app/lib/card-comment-core'

describe('a tag email opens the board the card is actually on (4 Nov 2026)', () => {
  it('a card still being made opens on the Editor board for a super admin', () => {
    expect(cardPathForRole('super_admin', 'c1', 'draft_uploaded')).toBe('/dashboard/editor?card=c1')
  })
  it('an approved card opens on Post approval', () => {
    expect(cardPathForRole('super_admin', 'c1', 'approved_for_scheduling')).toBe('/dashboard/scheduler?card=c1')
  })
  it('a scheduler always lands on their own board', () => {
    expect(cardPathForRole('scheduler', 'c1', 'draft_uploaded')).toBe('/dashboard/scheduler?card=c1')
  })
})
