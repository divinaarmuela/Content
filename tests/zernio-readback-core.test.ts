import { describe, expect, it } from 'vitest'
import { readbackCandidates, readbackVerdict, notFoundStep, READBACK_AFTER_MS } from '../app/lib/zernio-readback-core'

/**
 * READ BACK WHAT ZERNIO DID (the rebuild spec §7, 16 Oct 2026). The live failure this pins: Jordan "3" was booked on
 * 30 Sep for 12 Oct; Zernio posted it at 01:31; the dispatcher could not reach the app from 6 to 15 Oct (the domain
 * outage — every run "Unable to reach SDK URL"); by the time it could, the job had left the old window (14 days from
 * the job's CREATED time), so it would never be looked at again and the client was asked to review a live post.
 */

const job = (id: string, status: string, created_at: string, scheduled_for: string | null, provider = 'z' + id) =>
  ({ id, status, created_at, scheduled_for, provider_post_id: provider })

describe('readbackCandidates: the window follows the posting time, never when the job was made', () => {
  const now = Date.parse('2026-10-16T01:00:00Z')

  it('the Jordan job (made 30 Sep, posting 12 Oct) is read back on 16 Oct', () => {
    const c = readbackCandidates([job('jordan', 'scheduled', '2026-09-30T07:44:57Z', '2026-10-12T01:30:00Z')], now)
    expect(c.map(j => j.id)).toEqual(['jordan'])
  })

  it('a job booked months ahead is read back around its own time', () => {
    const far = job('far', 'scheduled', '2026-06-01T00:00:00Z', '2026-10-15T23:00:00Z')
    expect(readbackCandidates([far], now)).toHaveLength(1)
  })

  it('not before its time (minus a day), and not more than 14 days after', () => {
    expect(readbackCandidates([job('early', 'scheduled', '2026-10-01T00:00:00Z', '2026-10-20T00:00:00Z')], now)).toHaveLength(0)
    expect(readbackCandidates([job('old', 'published', '2026-09-01T00:00:00Z', '2026-09-30T00:00:00Z')], now)).toHaveLength(0)
    expect(READBACK_AFTER_MS).toBe(14 * 24 * 3600_000)
  })

  it('only jobs Zernio has, and only ones still open or published', () => {
    const rows = [
      job('a', 'scheduled', '2026-10-01T00:00:00Z', '2026-10-15T00:00:00Z'),
      { ...job('b', 'scheduled', '2026-10-01T00:00:00Z', '2026-10-15T00:00:00Z'), provider_post_id: null },
      job('c', 'cancelled', '2026-10-01T00:00:00Z', '2026-10-15T00:00:00Z'),
      job('d', 'failed', '2026-10-01T00:00:00Z', '2026-10-15T00:00:00Z'),
    ]
    expect(readbackCandidates(rows, now).map(j => j.id)).toEqual(['a'])
  })

  it('no cap of 50: every job in the window, the oldest posting time first', () => {
    const many = Array.from({ length: 120 }, (_, i) => job(`j${i}`, 'scheduled', '2026-10-01T00:00:00Z', new Date(now - (i + 1) * 3600_000).toISOString()))
    const c = readbackCandidates(many, now)
    expect(c).toHaveLength(120)
    expect(c[0].id).toBe('j119')
  })

  it('a job with no posting time falls back to when it was made', () => {
    expect(readbackCandidates([job('now', 'published', '2026-10-15T00:00:00Z', null)], now)).toHaveLength(1)
  })
})

describe('readbackVerdict: what Zernio\'s answer means, pinned on the real Jordan response', () => {
  // GET /v1/analytics?postId=6abcbe10… on 16 Oct 2026 (trimmed)
  const jordan = {
    status: 'published', publishedAt: '2026-10-12T01:31:23.160Z',
    platformAnalytics: [{ platform: 'linkedin', status: 'published' }, { platform: 'instagram', status: 'published' }],
  }

  it('the Jordan answer is posted on both networks', () => {
    expect(readbackVerdict(jordan, ['linkedin', 'instagram'])).toEqual({ kind: 'posted' })
  })

  it('accepted but not out yet (published, no publishedAt, no platform live) is still waiting', () => {
    expect(readbackVerdict({ status: 'published', publishedAt: null, platformAnalytics: [] }, ['instagram'])).toEqual({ kind: 'waiting' })
  })

  it('one network out, the other not yet: waiting, never posted', () => {
    expect(readbackVerdict({ status: 'published', publishedAt: 'x', platformAnalytics: [{ platform: 'linkedin', status: 'published' }] }, ['linkedin', 'instagram'])).toEqual({ kind: 'waiting' })
  })

  it('a refused network makes it partial; TikTok still processing is a wait', () => {
    expect(readbackVerdict({ status: 'published', publishedAt: 'x', platformAnalytics: [{ platform: 'linkedin', status: 'published' }, { platform: 'instagram', status: 'failed' }] }, ['linkedin', 'instagram'])).toEqual({ kind: 'partial' })
    expect(readbackVerdict({ status: 'failed', platformAnalytics: [{ platform: 'instagram', status: 'failed' }] }, ['instagram'])).toEqual({ kind: 'failed' })
  })

  it('Zernio\'s "not found" (the real 404 body) is not-found, not failed', () => {
    expect(readbackVerdict({ error: 'Post not found', type: 'not_found', code: 'post_not_found' }, ['instagram'])).toEqual({ kind: 'not_found' })
  })

  it('a deleted or cancelled post at Zernio says so', () => {
    expect(readbackVerdict({ status: 'deleted' }, ['instagram'])).toEqual({ kind: 'gone' })
    expect(readbackVerdict({ status: 'cancelled' }, ['instagram'])).toEqual({ kind: 'gone' })
  })

  it('no answer at all (the network failed) is unknown — never not-found', () => {
    expect(readbackVerdict(null, ['instagram'])).toEqual({ kind: 'unknown' })
  })
})

describe('notFoundStep: one missing answer never removes a post (an outage must not cancel real posts)', () => {
  const t0 = Date.parse('2026-10-16T00:00:00Z')

  it('the first not-found only flags it', () => {
    expect(notFoundStep({ misses: [] }, t0, { zernioHealthy: true })).toEqual({ misses: [new Date(t0).toISOString()], action: 'flag' })
  })

  it('three not-founds at least 30 minutes apart, while Zernio answers other posts, removes it', () => {
    const s1 = notFoundStep({ misses: [] }, t0, { zernioHealthy: true })
    const s2 = notFoundStep(s1, t0 + 31 * 60_000, { zernioHealthy: true })
    expect(s2.action).toBe('flag')
    const s3 = notFoundStep(s2, t0 + 62 * 60_000, { zernioHealthy: true })
    expect(s3.action).toBe('remove')
  })

  it('three in quick succession are one miss', () => {
    let s = notFoundStep({ misses: [] }, t0, { zernioHealthy: true })
    s = notFoundStep(s, t0 + 5 * 60_000, { zernioHealthy: true })
    s = notFoundStep(s, t0 + 10 * 60_000, { zernioHealthy: true })
    expect(s.misses).toHaveLength(1)
    expect(s.action).toBe('flag')
  })

  it('while Zernio is not answering other posts either, nothing counts', () => {
    const s = notFoundStep({ misses: ['2026-10-15T00:00:00Z', '2026-10-15T01:00:00Z'] }, t0, { zernioHealthy: false })
    expect(s).toEqual({ misses: ['2026-10-15T00:00:00Z', '2026-10-15T01:00:00Z'], action: 'none' })
  })
})
