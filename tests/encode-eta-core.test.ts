import { describe, expect, it } from 'vitest'
import { copiesLateWords, copiesReadyAt, earliestSafeTime } from '../app/lib/encode-eta-core'
import { MIN_LEAD_MS } from '../app/lib/social-schedule-core'

/* ── a booked time is a promise the copies have to keep (10 Sep 2026) ───── */

const NOW = Date.parse('2026-09-09T14:55:00Z')
const at = (s: string) => Date.parse(s)

describe('copiesReadyAt', () => {
  it('is null when every copy is done, or none is wanted', () => {
    expect(copiesReadyAt([{ platform: 'tiktok', status: 'done', created_at: '2026-09-09T14:54:00Z' }], ['tiktok'], NOW)).toBeNull()
    expect(copiesReadyAt([{ platform: 'tiktok', status: 'running', created_at: '2026-09-09T14:54:00Z' }], ['instagram'], NOW)).toBeNull()
    expect(copiesReadyAt([], ['tiktok'], NOW)).toBeNull()
  })

  it('a 4K copy of a two-minute clip needs about twenty minutes; 1080p about seven', () => {
    const fourK = copiesReadyAt([{ platform: 'tiktok', status: 'running', created_at: '2026-09-09T14:54:00Z', duration_sec: 108, width: 3840, height: 2160 }], ['tiktok'], NOW)!
    expect((fourK - at('2026-09-09T14:54:00Z')) / 60_000).toBeCloseTo(108 * 10 / 60 + 1 + 2, 0)
    const hd = copiesReadyAt([{ platform: 'instagram', status: 'queued', created_at: '2026-09-09T14:54:00Z', duration_sec: 108, width: 1920, height: 1080 }], ['instagram'], NOW)!
    // a queued copy starts when the encoder is free — now, at the earliest
    expect((hd - NOW) / 60_000).toBeCloseTo(108 * 3.5 / 60 + 1 + 2, 0)
  })

  it('copies of one file wait for each other, so the second finishes after the first', () => {
    const rows = [
      { platform: 'tiktok', status: 'running', created_at: '2026-09-09T14:54:00Z', duration_sec: 60, width: 1920, height: 1080 },
      { platform: 'instagram', status: 'queued', created_at: '2026-09-09T14:54:01Z', duration_sec: 60, width: 1920, height: 1080 },
    ]
    const both = copiesReadyAt(rows, ['tiktok', 'instagram'], NOW)!
    const one = copiesReadyAt(rows.slice(0, 1), ['tiktok'], NOW)!
    expect(both).toBeGreaterThan(one)
    expect(both - one).toBeCloseTo(60 * 3.5 * 1000 + 60_000, -3)
  })

  it('an unmeasured clip is budgeted as two minutes, and the caller may say the length', () => {
    const blind = copiesReadyAt([{ platform: 'tiktok', status: 'queued', created_at: '2026-09-09T14:54:00Z' }], ['tiktok'], NOW)!
    const told = copiesReadyAt([{ platform: 'tiktok', status: 'queued', created_at: '2026-09-09T14:54:00Z' }], ['tiktok'], NOW, 30)!
    expect(blind).toBeGreaterThan(told)
  })
})

describe('the earliest safe time, and the words', () => {
  it('is the 15-minute lead when the copies are done, the copies when they are not', () => {
    expect(earliestSafeTime(NOW, null)).toBe(NOW + MIN_LEAD_MS)
    expect(earliestSafeTime(NOW, NOW + 60 * 60_000)).toBe(NOW + 60 * 60_000)
    expect(earliestSafeTime(NOW, NOW + 60_000)).toBe(NOW + MIN_LEAD_MS)
  })
  it('names the channels and both times', () => {
    const w = copiesLateWords(['TikTok', 'Instagram'], NOW, NOW + 120_000, ms => new Date(ms).toISOString().slice(11, 16))
    expect(w).toBe('The clean copies for TikTok and Instagram will be ready by about 14:55 — the earliest safe time is 14:57. Pick a time after that, or wait for the copies.')
  })
})
