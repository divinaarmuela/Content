import { describe, it, expect } from 'vitest'
import { dayIn, kindWord, newestFirst, todayState } from '../app/lib/today-posts-core'

const now = new Date('2026-11-04T04:30:00Z') // 3:30pm Melbourne

describe('Post approval: going out today (4 Nov 2026)', () => {
  it('reads the day in Melbourne, not UTC', () => {
    expect(dayIn('2026-11-03T14:00:00Z')).toBe('2026-11-04') // 1am Melbourne
  })
  it('latest time first', () => {
    expect(newestFirst([{ at: '2026-11-04T01:00:00Z' }, { at: '2026-11-04T05:00:00Z' }]).map(r => r.at)).toEqual(['2026-11-04T05:00:00Z', '2026-11-04T01:00:00Z'])
  })
  it('Zernio failing on one platform beats our own "booked"', () => {
    const st = todayState({ stage: 'booked', jobStatus: 'scheduled', at: '2026-11-04T04:00:00Z', now,
      zernio: { status: 'partial', platforms: [{ platform: 'instagram', status: 'published' }, { platform: 'tiktok', status: 'failed' }] } })
    expect(st).toMatchObject({ label: 'Failed on 1 of 2', tone: 'red', needsAction: true })
  })
  it('a draft due today needs approval; past its time it turns red', () => {
    expect(todayState({ stage: 'draft', at: '2026-11-04T06:00:00Z', now })).toMatchObject({ tone: 'amber', needsAction: true })
    expect(todayState({ stage: 'with_client', at: '2026-11-04T01:00:00Z', now }).tone).toBe('red')
  })
  it('booked and pending at Zernio reads Scheduled', () => {
    expect(todayState({ stage: 'booked', jobStatus: 'scheduled', at: '2026-11-04T04:40:00Z', now,
      zernio: { status: 'scheduled', platforms: [{ platform: 'instagram', status: 'pending' }] } }).label).toBe('Scheduled')
  })
  it('names the kind: 4 images is a carousel, a story is a story', () => {
    expect(kindWord({ images: 4, videos: 0, platform: 'instagram' })).toBe('Carousel')
    expect(kindWord({ stated: 'story', images: 1, videos: 0, platform: 'instagram' })).toBe('Story')
    expect(kindWord({ images: 0, videos: 1, platform: 'instagram' })).toBe('Reel')
  })
})
