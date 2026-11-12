import { describe, it, expect } from 'vitest'
import { approvedWithComment } from '../app/lib/post-board-core'

const review = (over: object = {}) => ({ version: 2, verdict: 'approved', note: 'change FUND to BROKER', by: 'Anthony', at: '2026-11-12T04:07:58.000Z', ...over })

describe('approved, with a comment (12 Nov 2026 — a comment typed before Approve was lost)', () => {
  it('says who approved and what they said, on the Post approval card', () => {
    expect(approvedWithComment({ stage: 'booked', sent_version: 2, client_review: review() } as never))
      .toBe('Anthony approved, with a comment: change FUND to BROKER')
  })
  it('says nothing for a plain approval, a no, or an earlier version', () => {
    expect(approvedWithComment({ stage: 'booked', sent_version: 2, client_review: review({ note: null }) } as never)).toBeNull()
    expect(approvedWithComment({ stage: 'booked', sent_version: 2, client_review: review({ verdict: 'not_approved' }) } as never)).toBeNull()
    expect(approvedWithComment({ stage: 'booked', sent_version: 3, client_review: review() } as never)).toBeNull()
    expect(approvedWithComment({ stage: 'posted', sent_version: 2, client_review: review() } as never)).toBeNull()
  })
})
