import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { ALREADY_SPLIT, splitAlreadyDone } from '../app/lib/split-core'

// 29 Oct 2026, the ZZ E2E walk: a card split on 2 Oct came back to the client and "Send my answers" could never go
describe('a split guards its own round only', () => {
  it('never split: may split', () => {
    expect(splitAlreadyDone({}, 3, null)).toBe(false)
  })
  it('split this round: refused; split in an earlier round: may split again', () => {
    expect(splitAlreadyDone({ split_at: '2026-10-29T00:00:00Z', split_for_round: 3 }, 3, null)).toBe(true)
    expect(splitAlreadyDone({ split_at: '2026-10-02T00:00:00Z', split_for_round: 2 }, 3, null)).toBe(false)
  })
  it('an older split with no round: refused unless the card went to the client again after it', () => {
    expect(splitAlreadyDone({ split_at: '2026-10-02T12:46:00Z' }, 3, null)).toBe(true)
    expect(splitAlreadyDone({ split_at: '2026-10-02T12:46:00Z' }, 3, '2026-10-01T00:00:00Z')).toBe(true)
    expect(splitAlreadyDone({ split_at: '2026-10-02T12:46:00Z' }, 3, '2026-10-28T22:56:00Z')).toBe(false)
  })
  it('the split records its round and says plainly when the answers are already in', () => {
    const s = readFileSync('app/lib/split.ts', 'utf8')
    expect(s).toContain('split_at: now, split_for_round: plan.round')
    expect(s).toContain('throw new AuthzError(ALREADY_SPLIT, 409)')
    expect(ALREADY_SPLIT).not.toMatch(/changed while you were looking/)
  })
})
