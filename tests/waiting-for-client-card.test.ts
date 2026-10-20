import { describe, expect, it } from 'vitest'
import { scheduleFacts } from '@/app/lib/schedule-stage-core'
import { WAITING_FOR_CLIENT, postTone, readPostState, type AccountRef, type PostState } from '@/app/lib/post-stage-core'

// the owner, 20 Oct 2026: a "Wait for the client" post shows amber "Waiting for client" on the card, not Booked in
const NOW = '2026-10-20T00:00:00.000Z'
const ACCOUNTS: AccountRef[] = [{ id: 'ig', platform: 'instagram', live: true }]
const post = (over: Record<string, unknown> = {}): PostState => readPostState({
  id: 'p1', client_id: 'c1', created_by: 'maker', stage: 'booked', rev: 3, stage_at: NOW, draft_version: 1, sent_version: 1,
  scheduled_for: '2026-10-22T07:00:00.000Z', channels: ['ig'], slides: [{ url: 'https://x/a.jpg', name: 'a.jpg', type: 'image' }],
  caption: 'Hi', per_channel: {}, approval: { version: 1, by: 'md', hat: 'super_admin', at: NOW },
  booking: { at: NOW, for_time: '2026-10-22T07:00:00.000Z', job_ids: ['j'], pending: false },
  ...over,
})!

describe('a booked post waiting for the client', () => {
  it('reads Waiting for client, in amber, and says it will not go out unless they approve', () => {
    const f = scheduleFacts(post({ if_no_answer: 'wait' }), ACCOUNTS, NOW)
    expect(f.label).toBe('Waiting for client')
    expect(f.tone).toBe('amber')
    expect(f.line).toMatch(/Will not go out unless the client approves/)
    expect(postTone(post({ if_no_answer: 'wait' }), NOW)).toBe(WAITING_FOR_CLIENT.tone)
  })
  it('is plain Booked in once the client approves, or when it posts anyway', () => {
    const approved = post({ if_no_answer: 'wait', client_review: { version: 1, verdict: 'approved', note: null, by: 'the client', at: NOW } })
    expect(scheduleFacts(approved, ACCOUNTS, NOW).label).toBe('Booked in')
    expect(scheduleFacts(post({ if_no_answer: 'post' }), ACCOUNTS, NOW).label).toBe('Booked in')
    expect(scheduleFacts(post(), ACCOUNTS, NOW).tone).toBe('blue')
  })
})
