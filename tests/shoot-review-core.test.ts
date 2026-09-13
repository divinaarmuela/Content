import { describe, expect, it } from 'vitest'
import { reviewAskPatch, reviewWords, reviewersFor, type SopShoot } from '../app/lib/shoot-sop-core'

/**
 * ASK FOR A REVIEW (13 Sep 2026): a general user writes the plan and asks
 * the account managers (or one person) to look at it. The "Aligned with the
 * strategist" tick after the ask is the sign-off.
 */
const AM = 'am', AM2 = 'am2', ME = 'me', ED = 'ed'
const managers = [
  { id: AM, role: 'account_manager', active_status: true },
  { id: AM2, role: 'super_admin', active_status: true },
  { id: ED, role: 'editor', active_status: true },
  { id: 'gone', role: 'account_manager', active_status: false },
]
const nameOf = (id: string | null | undefined) => ({ am: 'Karly', am2: 'Abby', me: 'Raina', ed: 'Sam' } as Record<string, string>)[String(id)] ?? null

describe('who is asked', () => {
  it('defaults to the active account managers and super admins on the client, never the asker', () => {
    expect(reviewersFor(ME, null, managers)).toEqual([AM, AM2])
    expect(reviewersFor(AM, [], managers)).toEqual([AM2])
  })
  it('a picked person wins, and the asker is never asked', () => {
    expect(reviewersFor(ME, [ED], managers)).toEqual([ED])
    expect(reviewersFor(ME, [ME, ED, ED], managers)).toEqual([ED])
  })
})

describe('the stamps and the line', () => {
  const base = { id: 'b', client_id: 'c', title: 'Golf', status: 'brief', owner_id: ME } as unknown as SopShoot
  it('stamps who asked, whom, and when', () => {
    expect(reviewAskPatch('2026-09-13T06:00:00Z', ME, [AM])).toEqual({ review_asked_at: '2026-09-13T06:00:00Z', review_asked_by: ME, review_asked_to: [AM] })
  })
  it('reads "waiting on their tick" until the tick lands after the ask', () => {
    expect(reviewWords(base, nameOf)).toBeNull()
    const asked = { ...base, ...reviewAskPatch('2026-09-13T06:00:00Z', ME, [AM]) } as SopShoot
    expect(reviewWords(asked, nameOf)).toMatch(/^Review asked from Karly by Raina, .* — waiting on their tick$/)
    const ticked = { ...asked, aligned_at: '2026-09-13T08:00:00Z', aligned_by: AM } as SopShoot
    expect(reviewWords(ticked, nameOf)).toMatch(/^Reviewed and aligned by Karly/)
    // a tick from BEFORE the ask does not count as this review
    const stale = { ...asked, aligned_at: '2026-09-12T08:00:00Z', aligned_by: AM } as SopShoot
    expect(reviewWords(stale, nameOf)).toMatch(/waiting on their tick$/)
  })
})
