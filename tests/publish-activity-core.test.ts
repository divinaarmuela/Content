import { describe, it, expect } from 'vitest'
import {
  attentionLine, jobWords, looksStuck, platformsNamedIn, sortForAttention,
  type PublishJob,
} from '../app/lib/publish-activity-core'

const NOW = Date.parse('2026-08-31T05:00:00Z')

const job = (over: Partial<PublishJob> = {}): PublishJob => ({
  id: 'j1', client_id: 'c1', caption: 'Test', media: [], targets: [
    { platform: 'instagram', accountId: 'a' },
    { platform: 'tiktok', accountId: 'b' },
  ],
  status: 'queued', scheduled_for: null, timezone: 'Australia/Melbourne',
  provider_post_id: null, permalink: null, error: null, attempts: 0,
  created_at: '2026-08-31T04:09:00Z', updated_at: '2026-08-31T04:09:00Z', published_at: null,
  ...over,
})

describe('a job read back as a sentence', () => {
  it('says a booked post is booked, in the client\'s zone', () => {
    const w = jobWords(job({ status: 'scheduled', scheduled_for: '2026-09-04T23:00:00Z' }), NOW)
    // 23:00 UTC is 9:00 am the next day in Melbourne — the audience's clock
    expect(w.headline).toMatch(/^Booked for Sat 5 Sept? 2026, 9:00 am AEST/)
    expect(w.canCancel).toBe(true)
    expect(w.canRetry).toBe(false)
  })

  it('tells someone their media is uploading rather than that something went wrong', () => {
    const w = jobWords(job({ media: [{ url: 'https://x/a.mp4', type: 'video' }] }), NOW)
    expect(w.headline).toBe('Waiting to send')
    expect(w.detail).toMatch(/uploaded in the background/)
    expect(w.tone).toBe('waiting')
  })

  it('explains a rescued job — the person watching saw it stall', () => {
    const w = jobWords(job({ error: 'Publishing was interrupted; the job was returned to the queue' }), NOW)
    expect(w.detail).toMatch(/cut off.*retried automatically/i)
  })

  it('shows the error in full and offers a retry on a failure', () => {
    const w = jobWords(job({ status: 'failed', error: 'tiktok: video exceeds 10 minutes' }), NOW)
    expect(w.headline).toBe('Did not go out')
    expect(w.detail).toBe('tiktok: video exceeds 10 minutes')
    expect(w.canRetry).toBe(true)
    expect(w.canCancel).toBe(false)
  })

  it('never offers to cancel a post that is mid-send', () => {
    expect(jobWords(job({ status: 'publishing' }), NOW).canCancel).toBe(false)
  })

  it('calls a duplicate what it is — not a failure', () => {
    const w = jobWords(job({ status: 'duplicate' }), NOW)
    expect(w.tone).toBe('quiet')
    expect(w.detail).toMatch(/not sent twice/)
  })
})

describe('a job that has been "sending" too long', () => {
  it('is stuck after fifteen minutes with no update', () => {
    const stale = job({ status: 'publishing', updated_at: '2026-08-31T04:30:00Z' })
    expect(looksStuck(stale, NOW)).toBe(true)
  })
  it('is not stuck a minute in', () => {
    expect(looksStuck(job({ status: 'publishing', updated_at: '2026-08-31T04:59:30Z' }), NOW)).toBe(false)
  })
  it('only ever applies to publishing', () => {
    expect(looksStuck(job({ status: 'queued', updated_at: '2026-08-30T00:00:00Z' }), NOW)).toBe(false)
  })
})

describe('naming the channel that failed', () => {
  it('reads the platform out of the provider\'s error', () => {
    const targets = job().targets
    expect(platformsNamedIn('TikTok rejected the video: too long', targets)).toEqual(['tiktok'])
    expect(platformsNamedIn('instagram: caption too long; tiktok: fine', targets)).toEqual(['instagram', 'tiktok'])
    expect(platformsNamedIn('Provider error 500', targets)).toEqual([])
    expect(platformsNamedIn(null, targets)).toEqual([])
  })
})

describe('what the page leads with', () => {
  it('puts failures first, then the ones on the way, then the rest', () => {
    const order = sortForAttention([
      job({ id: 'live', status: 'published' }),
      job({ id: 'booked', status: 'scheduled' }),
      job({ id: 'broken', status: 'failed' }),
      job({ id: 'moving', status: 'publishing' }),
    ]).map(j => j.id)
    expect(order).toEqual(['broken', 'moving', 'booked', 'live'])
  })

  it('summarises only what is live', () => {
    expect(attentionLine([
      job({ status: 'failed' }), job({ status: 'queued' }), job({ status: 'scheduled' }), job({ status: 'published' }),
    ])).toBe('1 did not go out · 1 on the way · 1 booked')
    expect(attentionLine([job({ status: 'published' })])).toBeNull()
  })
})
