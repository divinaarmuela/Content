import { describe, expect, it } from 'vitest'
import { includedIds, includedLines, type CandidatePost, type ReportData } from '../app/lib/client-report-core'

const c = (id: string, byMdm: boolean): CandidatePost => ({ id, platform: 'instagram', publishedAt: '2026-10-05T00:00:00Z', url: null, thumbnail: null, caption: 'x', format: 'reel', views: 10, byMdm })

describe('posts in this report (5 Nov 2026)', () => {
  it('starts with MD Media’s own posts ticked', () => {
    expect([...includedIds(undefined, [c('a', true), c('b', false)])]).toEqual(['a'])
  })
  it('ticks every post when none went out through MD Media', () => {
    expect([...includedIds(null, [c('a', false), c('b', false)])].sort()).toEqual(['a', 'b'])
  })
  it('keeps the team’s own ticks, added posts included', () => {
    expect([...includedIds(['b'], [c('a', true), c('b', false)])]).toEqual(['b'])
  })
  it('tells the writer which posts, and marks the added ones', () => {
    const data = { candidates: [c('a', true), c('b', false)] } as unknown as ReportData
    const lines = includedLines(data, new Set(['a', 'b'])).join('\n')
    expect(lines).toContain('2 of the month')
    expect(lines).toContain('added by the team')
    expect(includedLines(data, null)).toEqual([])
  })
})

describe('the accounts in a report (5 Nov 2026)', async () => {
  const { includedPlatforms, scopeData, platformLabel } = await import('../app/lib/client-report-core')
  it('starts with Instagram and Facebook; TikTok and LinkedIn only when ticked', () => {
    expect([...includedPlatforms(undefined, ['instagram', 'facebook', 'tiktok', 'linkedin'])]).toEqual(['instagram', 'facebook'])
    expect([...includedPlatforms(['instagram', 'tiktok'], ['instagram', 'facebook', 'tiktok'])]).toEqual(['instagram', 'tiktok'])
  })
  it('a client with only TikTok still gets a report', () => {
    expect([...includedPlatforms(undefined, ['tiktok'])]).toEqual(['tiktok'])
  })
  it('a ticked account no longer connected drops out', () => {
    expect([...includedPlatforms(['linkedin', 'instagram'], ['instagram'])]).toEqual(['instagram'])
  })
  it('only the ticked accounts and their posts are kept', () => {
    const data = { platforms: [{ platform: 'instagram' }, { platform: 'tiktok' }], candidates: [c('a', true), { ...c('b', true), platform: 'tiktok' }] } as unknown as ReportData
    const s = scopeData(data, new Set(['instagram']))
    expect(s.platforms.map(p => p.platform)).toEqual(['instagram'])
    expect(s.candidates!.map(x => x.id)).toEqual(['a'])
    expect(platformLabel('linkedin')).toBe('LinkedIn')
  })
})

describe('followers at the month end (5 Nov 2026, Kode Finance)', async () => {
  const { monthFollowers } = await import('../app/lib/client-report-core')
  it('the month shows what it gained, not 0', () => {
    expect(monthFollowers(2414, 5, 43)).toEqual({ start: 2366, end: 2409, previousEnd: 2366, gained: 43 })
  })
})

describe('followers from Zernio’s monthly counts (5 Nov 2026)', async () => {
  const { followerMonth, nextMonthStart } = await import('../app/lib/client-report-core')
  it('Kode Instagram, October: 2,390 on 1 Oct, 2,414 on 1 Nov', () => {
    expect(followerMonth(2390, 2414, null)).toEqual({ start: 2390, end: 2414, previousEnd: 2390, gained: 24, previousGained: null })
  })
  it('a count Zernio does not have stays empty', () => {
    expect(followerMonth(null, 2414, null).gained).toBeNull()
    expect(nextMonthStart('2026-12')).toBe('2027-01-01')
  })
})
