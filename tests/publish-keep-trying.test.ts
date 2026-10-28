import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { GIVE_UP_LEAD_MS, HARD_CAP_ATTEMPTS, LATE_RETRY_GAP_MS, giveUpPublishing, mayTryAgainLater } from '../app/lib/post-outcome-core'

// Justin's 14 and 17 Nov posts, re-booked 28 Oct 2026: Zernio unreachable, five tries in the hour, both thrown back
const now = Date.parse('2026-10-28T09:00:00Z')
const day = 24 * 60 * 60 * 1000
describe('a booking far from its time keeps trying', () => {
  it('within its usual tries it never gives up', () => {
    expect(giveUpPublishing(3, 5, '2026-11-14T03:30:00Z', now)).toBe(false)
  })
  it('past them: far off keeps trying; close, no time, or the hard cap gives up', () => {
    expect(giveUpPublishing(5, 5, '2026-11-14T03:30:00Z', now)).toBe(false)
    expect(giveUpPublishing(5, 5, new Date(now + GIVE_UP_LEAD_MS - 1).toISOString(), now)).toBe(true)
    expect(giveUpPublishing(5, 5, null, now)).toBe(true)
    expect(giveUpPublishing(HARD_CAP_ATTEMPTS, 5, new Date(now + 30 * day).toISOString(), now)).toBe(true)
  })
  it('handed over again only a quarter hour after its last go', () => {
    const far = new Date(now + 10 * day).toISOString()
    expect(mayTryAgainLater({ attempts: 6, scheduled_for: far, updated_at: new Date(now - LATE_RETRY_GAP_MS + 1000).toISOString() }, 5, now)).toBe(false)
    expect(mayTryAgainLater({ attempts: 6, scheduled_for: far, updated_at: new Date(now - LATE_RETRY_GAP_MS).toISOString() }, 5, now)).toBe(true)
    expect(mayTryAgainLater({ attempts: 6, scheduled_for: new Date(now + 60_000).toISOString(), updated_at: '2026-10-01T00:00:00Z' }, 5, now)).toBe(false)
  })
  it('the job runner and the dispatcher both ask', () => {
    const s = readFileSync('app/lib/publish.ts', 'utf8')
    expect(s).toContain('if (giveUpPublishing(job.attempts + 1, MAX_PUBLISH_ATTEMPTS,')
    expect(s).toContain('mayTryAgainLater(j as never, MAX_PUBLISH_ATTEMPTS, Date.now())')
  })
})
