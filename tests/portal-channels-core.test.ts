import { describe, expect, it } from 'vitest'
import { portalChannelLines, portalChannelWords } from '../app/lib/portal-channels-core'
import { DRAFT_KIND, type OutcomeJob } from '../app/lib/post-outcome-core'

/* ── the client sees what each channel did, never the provider's reason ── */

const job = (over: Partial<OutcomeJob>): OutcomeJob => ({
  id: 'j', status: 'published', media: [{ url: 'https://r2/x.mp4', type: 'video' }],
  targets: [{ platform: 'instagram', options: { kind: 'reel' } }, { platform: 'tiktok' }],
  scheduled_for: '2026-09-10T03:15:00Z', published_at: '2026-09-10T03:17:00Z',
  created_at: '2026-09-10T02:56:00Z', updated_at: '2026-09-10T03:17:00Z', error: null, permalink: null,
  ...over,
})

describe('portalChannelLines', () => {
  it('puts a refused channel first, keeps the live link, and drops the reason', () => {
    const lines = portalChannelLines([job({
      platform_results: [
        { platform: 'instagram', status: 'published', kind: 'Reel', url: 'https://www.instagram.com/reel/x/', at: '2026-09-10T03:17:00Z', reason: null },
        { platform: 'tiktok', status: 'failed', kind: 'Video', url: null, at: '2026-09-10T03:17:00Z', reason: 'TikTok is at capacity' },
      ],
    })])
    expect(lines.map(l => [l.network, l.state, l.url])).toEqual([
      ['TikTok', 'failed', null],
      ['Instagram', 'published', 'https://www.instagram.com/reel/x/'],
    ])
    expect(JSON.stringify(lines)).not.toContain('capacity')
    expect(portalChannelWords(lines[0], null)).toMatch(/did not go out/)
    expect(portalChannelWords(lines[1], 'Thu 10 Sept, 1:17 pm')).toBe('went out Thu 10 Sept, 1:17 pm')
  })
  it('says booked for a scheduled job and draft for an inbox draft', () => {
    const booked = portalChannelLines([job({ status: 'scheduled', published_at: null, platform_results: null })])
    expect(booked.every(l => l.state === 'scheduled')).toBe(true)
    expect(portalChannelWords(booked[0], 'Thu 10 Sept, 1:15 pm')).toBe('going out Thu 10 Sept, 1:15 pm')
    const draft = portalChannelLines([job({ targets: [{ platform: 'tiktok', options: { tiktokDraft: true } }], platform_results: null })])
    expect(draft[0].state).toBe('draft')
    expect(draft[0].kind).toBe('Draft')
    expect(DRAFT_KIND).toBeTruthy()
  })
  it('reads the newest job when a piece was posted twice, and nothing with none', () => {
    const lines = portalChannelLines([
      job({ id: 'old', created_at: '2026-09-01T00:00:00Z', status: 'failed', platform_results: null }),
      job({ id: 'new', created_at: '2026-09-10T00:00:00Z', status: 'published', platform_results: null }),
    ])
    expect(lines.every(l => l.state === 'published')).toBe(true)
    expect(portalChannelLines([])).toEqual([])
  })
})
