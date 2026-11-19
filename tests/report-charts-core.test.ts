import { describe, expect, it } from 'vitest'
import { formatLabel, niceMax, shares, short, viewsByType } from '@/app/lib/report-charts-core'
import type { CandidatePost } from '@/app/lib/client-report-core'

// the owner, 19 Nov 2026: "add beautifully designed charts" — what each chart draws is the page's own figures
const post = (platform: string, format: string | null, views: number, reach?: number): CandidatePost =>
  ({ id: `${platform}-${format}-${views}`, platform, publishedAt: null, url: null, thumbnail: null, caption: '', format, views, byMdm: true, reach })

describe('the kinds of post', () => {
  it('are named in the team’s words', () => {
    expect(['reel', 'VIDEO', 'carousel_album', 'photo', 'story', 'text', null].map(formatLabel))
      .toEqual(['Reels', 'Reels', 'Carousels', 'Images', 'Stories', 'Other posts', 'Other posts'])
  })
})

describe('where the month’s posts were seen', () => {
  const posts = [post('instagram', 'reel', 600), post('instagram', 'video', 200), post('instagram', 'carousel', 150), post('instagram', 'image', 50), post('facebook', 'reel', 9000)]

  it('adds up one account’s posts by kind, largest first, with each share', () => {
    expect(viewsByType(posts, 'instagram')).toEqual([
      { label: 'Reels', value: 800, pct: 80 }, { label: 'Carousels', value: 150, pct: 15 }, { label: 'Images', value: 50, pct: 5 },
    ])
  })

  it('reads reach where the platform gives no views, and leaves out a kind nobody saw', () => {
    expect(viewsByType([post('linkedin', 'image', 0, 40), post('linkedin', 'carousel', 0, 60), post('linkedin', 'text', 0, 0)], 'linkedin'))
      .toEqual([{ label: 'Carousels', value: 60, pct: 60 }, { label: 'Images', value: 40, pct: 40 }])
  })

  it('an account with no posts has nothing to draw', () => {
    expect(viewsByType(posts, 'tiktok')).toEqual([])
  })
})

describe('a whole split into parts', () => {
  it('never has more parts than colours: the smallest fold into one', () => {
    const parts = shares([{ label: 'A', value: 50 }, { label: 'B', value: 20 }, { label: 'C', value: 15 }, { label: 'D', value: 10 }, { label: 'E', value: 5 }])
    expect(parts.map(p => p.label)).toEqual(['A', 'B', 'C', 'Other posts'])
    expect(parts[3].value).toBe(15)
    expect(parts.reduce((n, p) => n + p.pct, 0)).toBeCloseTo(100, 5)
  })
})

describe('the axis', () => {
  it('tops out at a round number at or above the largest day', () => {
    expect([4210, 947, 10, 0, 100000, 2600].map(niceMax)).toEqual([5000, 1000, 10, 1, 100000, 5000])
  })
  it('writes its numbers short', () => {
    expect([950, 12400, 2500000].map(short)).toEqual(['950', '12.4k', '2.5m'])
  })
})
