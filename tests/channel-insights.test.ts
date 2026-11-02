import { describe, expect, it } from 'vitest'
import {
  clampRange, durationWords, pct, readDemographics, readEnvelope, readPostDeep, readRetention, refusalWords,
  sectionsFor, shiftDays,
} from '../app/lib/channel-insights-core'

// shapes as Zernio returned them on 2 Nov 2026 (trimmed)
describe('a channel’s deep analytics (2 Nov 2026)', () => {
  it('reads the account-insights envelope: totals, day series, breakdowns, what was unavailable', () => {
    const e = readEnvelope({
      metrics: {
        reach: { total: 17004, values: [{ date: '2026-10-26', value: 9 }, { date: '2026-10-25', value: 8243 }] },
        follows_and_unfollows: { total: 0, breakdowns: [{ dimension: 'NON_FOLLOWER', value: 104 }, { dimension: 'FOLLOWER', value: 541 }] },
      },
      unavailableMetrics: ['page_video_views'], dataDelay: 'Data may be delayed up to 48 hours',
    })
    expect(e.totals.reach).toBe(17004)
    expect(e.series.reach.map(p => p.date)).toEqual(['2026-10-25', '2026-10-26'])
    expect(e.breakdowns.follows_and_unfollows[0]).toEqual({ label: 'FOLLOWER', value: 541 })
    expect(e.unavailable).toEqual(['page_video_views'])
    expect(e.delay).toMatch(/48 hours/)
  })

  it('sorts demographics biggest first and drops empty ones (under 100 followers comes back all empty)', () => {
    const d = readDemographics({ demographics: { city: [{ dimension: 'Sydney', value: 3 }, { dimension: 'Melbourne, Victoria', value: 1044 }], age: [] } })
    expect(d.city[0].label).toBe('Melbourne, Victoria')
    expect(d.age).toBeUndefined()
    expect(readDemographics({ demographics: { age: [], city: [], country: [], gender: [] } })).toEqual({})
  })

  it('moves Facebook’s day stamps back a day, and keeps account reads within 90 days', () => {
    expect(shiftDays([{ date: '2026-11-02', value: 5 }], -1)).toEqual([{ date: '2026-11-01', value: 5 }])
    expect(clampRange({ from: '2026-08-05', to: '2026-11-02' })).toEqual({ from: '2026-08-05', to: '2026-11-02', clamped: false })
    expect(clampRange({ from: '2025-11-03', to: '2026-11-02' })).toEqual({ from: '2026-08-05', to: '2026-11-02', clamped: true })
  })

  it('says why a platform refused, in plain words', () => {
    expect(refusalWords(400, { code: 'instagram_tagged_media_requires_facebook_login' }, 'instagram')).toMatch(/Facebook Login/)
    expect(refusalWords(412, {}, 'tiktok')).toMatch(/Reconnecting/)
    expect(refusalWords(402, {}, 'instagram')).toMatch(/add-on/)
    expect(refusalWords(500, { error: 'boom' }, 'x')).toMatch(/boom/)
  })

  it('reads a TikTok video’s audience, sources, retention and watch time (ms) from its row', () => {
    const d = readPostDeep({
      _id: 'p', platforms: [{ platform: 'tiktok', platformPostId: '7561', accountId: 'a' }],
      analytics: {
        igReelsAvgWatchTime: 12870, igReelsVideoViewTotalTime: 513992000, completionRate: 0.1658, follows: 377, profileViews: 881,
        impressionSources: { forYou: 0.985, search: 0.005, follow: 0 }, audienceTypes: { follower: 0.02, nonFollower: 0.98, newViewer: 0.78, returnViewer: 0.22 },
        audienceCountries: { US: 0.013, AU: 0.951, other: 0.014 }, retentionCurve: { '1': 0.84, '0': 1, '34': 0.14 }, videoDurationSeconds: 34.535,
      },
    })
    expect(d.platformPostId).toBe('7561')
    expect(d.countries[0]).toEqual({ label: 'AU', value: 0.951 })
    expect(d.sources.map(s => s.label)).toEqual(['forYou', 'search'])
    expect(d.retention.map(r => r.sec)).toEqual([0, 1, 34])
    expect(durationWords(d.avgWatchMs)).toBe('13 s')
    expect(durationWords(5000)).toBe('5.0 s')
    expect(durationWords(513992000)).toBe('143 h')
    expect(durationWords(30 * 3600_000)).toBe('30.0 h')
    expect(pct(d.completionRate)).toBe('17%')
    expect(pct(0.013)).toBe('1.3%')
    expect(readRetention(null)).toEqual([])
  })

  it('gives each network its own tabs', () => {
    expect(sectionsFor('instagram').map(s => s.key)).toEqual(['account', 'followers', 'audience', 'stories', 'tagged'])
    expect(sectionsFor('tiktok').map(s => s.key)).toEqual(['account'])
    expect(sectionsFor('facebook').map(s => s.key)).toEqual(['page', 'audience'])
    expect(sectionsFor('linkedin').map(s => s.key)).toEqual(['page', 'audience'])
  })
})
