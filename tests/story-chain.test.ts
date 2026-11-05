import { describe, expect, it } from 'vitest'
import { storyPredecessor, waitsFor, storyAccount, type ChainJob } from '../app/lib/story-chain-core'
import { providerTiming } from '../app/lib/post-outcome-core'

const story = (id: string, at: string, status = 'queued', account = 'A'): ChainJob =>
  ({ id, status, scheduled_for: at, created_at: '2026-11-02T00:00:00Z', targets: [{ platform: 'instagram', accountId: account, options: { kind: 'story' } }] })

describe('stories go out in order (5 Nov 2026)', () => {
  const s1 = story('s1', '2026-11-05T04:00:00Z', 'scheduled')
  const s2 = story('s2', '2026-11-05T04:01:00Z')
  it('the second waits for the first until it is published', () => {
    expect(storyPredecessor(s2, [s1, s2])?.id).toBe('s1')
    expect(waitsFor(storyPredecessor(s2, [s1, s2]))).toBe(true)
    expect(waitsFor(storyPredecessor(s2, [{ ...s1, status: 'published' }, s2]))).toBe(false)
  })
  it('a failed first story does not hold the next one', () => {
    expect(storyPredecessor(s2, [{ ...s1, status: 'failed' }, s2])).toBeNull()
  })
  it('other accounts, feed posts and stories over an hour apart are not chained', () => {
    expect(storyPredecessor(s2, [story('x', '2026-11-05T04:00:00Z', 'scheduled', 'B')])).toBeNull()
    expect(storyPredecessor(s2, [{ ...s1, targets: [{ platform: 'instagram', accountId: 'A', options: {} }] }])).toBeNull()
    expect(storyPredecessor(story('late', '2026-11-05T06:00:00Z'), [s1])).toBeNull()
    expect(storyAccount({ targets: [{ platform: 'instagram', accountId: 'A', options: { kind: 'story' } }, { platform: 'facebook', accountId: 'F', options: { kind: 'story' } }] })).toBeNull()
  })
  it('three in a row: each waits only for the one right before it', () => {
    const s3 = story('s3', '2026-11-05T04:02:00Z')
    expect(storyPredecessor(s3, [s1, s2, s3])?.id).toBe('s2')
  })
  it('the first story is never held', () => {
    expect(storyPredecessor(s1, [s1, s2])).toBeNull()
  })
  it('a chained story whose time passed while it waited still goes', () => {
    const now = new Date('2026-11-05T04:20:00Z')
    expect(providerTiming({ scheduled_for: '2026-11-05T04:01:00Z', chained_after: 's1' }, now)).toEqual({ send: 'now' })
    expect(providerTiming({ scheduled_for: '2026-11-05T04:01:00Z' }, now).send).toBe('refuse')
  })
})
