import { describe, it, expect } from 'vitest'
import {
  EMPTY_METRICS, METRICS_PENDING_LINE, compactCount, isStale, melbourneMonthKey,
  metricCells, metricForType, metricsPending, monthTotals, monthTotalsLine,
  numberOrNull, shapePostAnalytics, typeTotals, typeTotalsLine, updatedAgo,
} from '../app/lib/post-analytics-core'

/**
 * The numbers a client reads, and the words around them.
 *
 * Everything here is pure, so it is tested against the provider's REAL
 * response shape (captured from /analytics?postId=… on the one connected test
 * account) rather than against a shape we invented to be easy.
 */

/** The provider's body, as it actually comes back. */
const LIVE_BODY = {
  status: 'published',
  publishedAt: '2026-08-14T04:12:00.000Z',
  analytics: {
    impressions: 0, reach: 0, likes: 0, comments: 0, shares: 0, saves: 0,
    clicks: 0, views: 0, engagementRate: 0, lastUpdated: '2026-08-27T01:00:00.000Z',
  },
  platformAnalytics: [{
    platform: 'instagram',
    status: 'published',
    platformPostId: '17900000000000000',
    accountUsername: 'testbusinessaccount2026',
    analytics: {
      impressions: 3204, reach: 2810, likes: 214, comments: 12, shares: 9,
      saves: 31, views: 5120, engagementRate: 8.3,
    },
    syncStatus: 'synced',
    platformPostUrl: 'https://www.instagram.com/reel/ABC123/',
  }],
  syncStatus: 'synced',
  mediaType: 'REELS',
}

describe('shapePostAnalytics', () => {
  it('prefers the per-platform block over the roll-up', () => {
    const row = shapePostAnalytics('6a8faaa01698b3a6a0cc1648', LIVE_BODY)!
    expect(row.views).toBe(5120)
    expect(row.reach).toBe(2810)
    expect(row.impressions).toBe(3204)
    expect(row.likes).toBe(214)
    expect(row.saves).toBe(31)
    expect(row.engagement_rate).toBe(8.3)
    expect(row.platform).toBe('instagram')
    expect(row.platform_post_url).toBe('https://www.instagram.com/reel/ABC123/')
    expect(row.published_at).toBe('2026-08-14T04:12:00.000Z')
    expect(row.sync_status).toBe('synced')
  })

  it('picks the platform that carries the link, not merely the first', () => {
    const row = shapePostAnalytics('x', {
      platformAnalytics: [
        { platform: 'facebook', analytics: { likes: 1 } },
        { platform: 'instagram', platformPostUrl: 'https://insta/p/1', analytics: { likes: 9 } },
      ],
    })!
    expect(row.platform).toBe('instagram')
    expect(row.likes).toBe(9)
  })

  it('degrades to nulls rather than throwing on a shape it does not know', () => {
    const row = shapePostAnalytics('x', { status: 'published' })!
    expect(row.views).toBeNull()
    expect(row.platform_post_url).toBeNull()
    expect(row.sync_status).toBeNull()
  })

  it('refuses a body that is not one', () => {
    expect(shapePostAnalytics('x', null)).toBeNull()
    expect(shapePostAnalytics('x', 'nope')).toBeNull()
    expect(shapePostAnalytics('', LIVE_BODY)).toBeNull()
  })

  it('carries syncStatus:pending through — it is not the same as zero', () => {
    const row = shapePostAnalytics('x', {
      syncStatus: 'pending',
      platformAnalytics: [{ platform: 'instagram', syncStatus: 'pending', analytics: {} }],
    })!
    expect(row.sync_status).toBe('pending')
    expect(metricsPending(row)).toBe(true)
  })
})

/**
 * The exact body the live API returned for the one connected test account
 * (@testbusinessaccount2026, post 6a8faaa01698b3a6a0cc1648), captured minutes
 * after the post went out. It is here because it is the shape that breaks the
 * obvious implementation: `platformAnalytics[0].analytics` is **null** and the
 * roll-up is a block of **zeros** — placeholders, not measurements.
 */
const PENDING_BODY = {
  postId: '6a8faaa01698b3a6a0cc1648',
  status: 'published',
  publishedAt: '2026-08-27T03:35:10.397Z',
  analytics: {
    impressions: 0, reach: 0, likes: 0, comments: 0, shares: 0, saves: 0,
    clicks: 0, views: 0, engagementRate: 0, lastUpdated: null,
  },
  platformAnalytics: [{
    platform: 'instagram',
    status: 'published',
    platformPostId: '18632682472055181',
    accountUsername: 'testbusinessaccount2026',
    analytics: null,
    syncStatus: 'pending',
    platformPostUrl: null,
  }],
  platformPostUrl: null,
  syncStatus: 'pending',
  message: 'Analytics are being synced from the platform. Please try again in a few moments.',
  mediaType: 'video',
}

describe('a freshly published post, from the live API', () => {
  const row = shapePostAnalytics('6a8faaa01698b3a6a0cc1648', PENDING_BODY)!

  it('survives platformAnalytics[0].analytics being null', () => {
    expect(row).toBeTruthy()
    expect(row.platform).toBe('instagram')
  })

  it('stores NO numbers rather than the provider\'s placeholder zeros', () => {
    // this is the whole point: "0 views" on an hour-old Reel is a lie the
    // client would ring their account manager about
    expect(row.views).toBeNull()
    expect(row.likes).toBeNull()
    expect(row.impressions).toBeNull()
    expect(row.engagement_rate).toBeNull()
  })

  it('reads as pending, so the card promises numbers instead of printing zeroes', () => {
    expect(row.sync_status).toBe('pending')
    expect(metricsPending(row)).toBe(true)
    expect(metricCells(row)).toEqual([])
  })

  it('has no permalink yet — the platform assigns it later and the cron back-fills it', () => {
    expect(row.platform_post_url).toBeNull()
  })

  it('keeps the publish time, which is what "this month" is counted on', () => {
    expect(row.published_at).toBe('2026-08-27T03:35:10.397Z')
  })

  it('contributes nothing to the month totals rather than dragging them down', () => {
    const now = Date.parse('2026-08-27T05:00:00.000Z')
    expect(monthTotals([row], now)).toEqual({ views: 0, likes: 0, posts: 1 })
    expect(monthTotalsLine(monthTotals([row], now))).toBeNull()
  })
})

describe('numberOrNull', () => {
  it('keeps zero, which is a real answer', () => {
    expect(numberOrNull(0)).toBe(0)
  })
  it('rejects the things that are not numbers', () => {
    expect(numberOrNull(null)).toBeNull()
    expect(numberOrNull(undefined)).toBeNull()
    expect(numberOrNull('')).toBeNull()
    expect(numberOrNull('n/a')).toBeNull()
  })
  it('reads a formatted figure', () => {
    expect(numberOrNull('1,204')).toBe(1204)
  })
})

describe('metricCells — what the client actually sees', () => {
  it('is Views · Likes · Comments · Shares · Saves, in that order, plus Reach', () => {
    const cells = metricCells({
      ...EMPTY_METRICS, views: 5120, reach: 2810, likes: 214, comments: 12, shares: 9, saves: 31,
    })
    expect(cells.map(c => c.label)).toEqual(['Views', 'Reach', 'Likes', 'Comments', 'Shares', 'Saves'])
  })

  it('a still with no plays reports impressions AS views — the client is never taught that word', () => {
    const cells = metricCells({ ...EMPTY_METRICS, impressions: 900, reach: 700, likes: 4 })
    const views = cells.find(c => c.key === 'views')!
    expect(views.value).toBe(900)
    expect(cells.map(c => c.label)).not.toContain('Impressions')
  })

  it('drops the metrics the platform did not report, rather than printing 0', () => {
    const cells = metricCells({ ...EMPTY_METRICS, views: 12, likes: 3 })
    expect(cells.map(c => c.key)).toEqual(['views', 'likes'])
  })

  it('keeps a genuine zero — "0 saves" from the platform IS a fact', () => {
    const cells = metricCells({ ...EMPTY_METRICS, views: 12, saves: 0 })
    expect(cells.map(c => c.key)).toEqual(['views', 'saves'])
  })

  it('says nothing at all about a post with nothing to say', () => {
    expect(metricCells(EMPTY_METRICS)).toEqual([])
    expect(metricCells(null)).toEqual([])
  })
})

describe('metricsPending', () => {
  it('no row at all is pending', () => {
    expect(metricsPending(null)).toBe(true)
  })
  it("the provider's 'pending' is pending even with numbers attached", () => {
    expect(metricsPending({ sync_status: 'pending', views: 5 })).toBe(true)
  })
  it('a synced row with figures is not pending', () => {
    expect(metricsPending({ sync_status: 'synced', views: 5 })).toBe(false)
  })
  it('the pending line names no timeframe we cannot keep', () => {
    expect(METRICS_PENDING_LINE).toBe('Numbers arrive within the hour')
  })
})

describe('compactCount', () => {
  it('leaves a small number alone — 847 is not "0.8k"', () => {
    expect(compactCount(847)).toBe('847')
    expect(compactCount(0)).toBe('0')
    expect(compactCount(999)).toBe('999')
  })
  it('rounds past a thousand', () => {
    expect(compactCount(1204)).toBe('1.2k')
    expect(compactCount(12_400)).toBe('12.4k')
  })
  it('drops a pointless decimal', () => {
    expect(compactCount(12_000)).toBe('12k')
    expect(compactCount(1000)).toBe('1k')
  })
  it('goes whole above a hundred thousand', () => {
    expect(compactCount(124_000)).toBe('124k')
  })
  it('and again at a million', () => {
    expect(compactCount(1_240_000)).toBe('1.2m')
  })
  it('shows an em dash for a figure that does not exist', () => {
    expect(compactCount(null)).toBe('—')
    expect(compactCount(undefined)).toBe('—')
    expect(compactCount(NaN)).toBe('—')
  })
})

describe('updatedAgo', () => {
  const now = Date.parse('2026-08-27T12:00:00.000Z')
  const ago = (mins: number) => new Date(now - mins * 60_000).toISOString()

  it('counts minutes', () => {
    expect(updatedAgo(ago(12), now)).toBe('Updated 12 min ago')
  })
  it('collapses the first minute', () => {
    expect(updatedAgo(ago(0), now)).toBe('Updated just now')
  })
  it('switches to hours, then days, and gets the plural right', () => {
    expect(updatedAgo(ago(60), now)).toBe('Updated 1 hour ago')
    expect(updatedAgo(ago(180), now)).toBe('Updated 3 hours ago')
    expect(updatedAgo(ago(60 * 24), now)).toBe('Updated 1 day ago')
    expect(updatedAgo(ago(60 * 24 * 3), now)).toBe('Updated 3 days ago')
  })
  it('never reads as the future when a clock is a little ahead', () => {
    expect(updatedAgo(ago(-5), now)).toBe('Updated just now')
  })
  it('says nothing when it has no timestamp', () => {
    expect(updatedAgo(null)).toBeNull()
    expect(updatedAgo('not a date')).toBeNull()
  })
})

describe('the month boundary is Melbourne\'s, not the reader\'s', () => {
  it('an instant just before midnight AEST belongs to that day\'s month', () => {
    // 2026-08-31 23:30 Melbourne = 2026-08-31T13:30Z
    expect(melbourneMonthKey('2026-08-31T13:30:00.000Z')).toBe('2026-08')
  })
  it('…and the same instant is already September in UTC terms an hour later', () => {
    // 2026-09-01 00:30 Melbourne = 2026-08-31T14:30Z — still August by UTC,
    // September to the agency, and the agency's answer is the one that counts
    expect(melbourneMonthKey('2026-08-31T14:30:00.000Z')).toBe('2026-09')
  })
  it('refuses a date it cannot read', () => {
    expect(melbourneMonthKey('nonsense')).toBeNull()
  })
})

describe('monthTotals — "This month: 1.2k views · 84 likes"', () => {
  const now = Date.parse('2026-08-27T02:00:00.000Z') // 27 Aug, Melbourne

  const rows = [
    { published_at: '2026-08-14T04:12:00.000Z', views: 1000, likes: 50 },
    { published_at: '2026-08-20T04:12:00.000Z', views: 204, likes: 34 },
    // last month — must not count
    { published_at: '2026-07-30T04:12:00.000Z', views: 90_000, likes: 9000 },
    // this month, still pending — contributes nothing rather than a zero
    { published_at: '2026-08-25T04:12:00.000Z', views: null, likes: null },
    // never published — no month to belong to
    { published_at: null, views: 5, likes: 5 },
  ]

  it('adds up only the current Melbourne month', () => {
    expect(monthTotals(rows, now)).toEqual({ views: 1204, likes: 84, posts: 3 })
  })

  it('reads back as the line the portal prints', () => {
    expect(monthTotalsLine(monthTotals(rows, now))).toBe('This month: 1.2k views · 84 likes')
  })

  it('counts impressions as views for a still', () => {
    expect(monthTotals([{ published_at: '2026-08-14T00:00:00.000Z', impressions: 300 }], now).views)
      .toBe(300)
  })

  it('says nothing rather than "0 views" when the month has no numbers yet', () => {
    const empty = monthTotals([{ published_at: '2026-08-14T00:00:00.000Z' }], now)
    expect(empty.posts).toBe(1)
    expect(monthTotalsLine(empty)).toBeNull()
  })

  it('says nothing at all in a month with no posts', () => {
    expect(monthTotalsLine(monthTotals([], now))).toBeNull()
  })
})

describe('typeTotals — a Reel\'s plays are not a graphic\'s reach', () => {
  const now = Date.parse('2026-08-27T02:00:00.000Z')

  it('judges reels and videos on views, everything else on reach', () => {
    expect(metricForType('reel')).toBe('views')
    expect(metricForType('video')).toBe('views')
    expect(metricForType('carousel')).toBe('reach')
    expect(metricForType('static')).toBe('reach')
    expect(metricForType('story')).toBe('reach')
    expect(metricForType(null)).toBe('reach')
  })

  const rows = [
    { content_type: 'reel', published_at: '2026-08-02T00:00:00Z', views: 8000, reach: 1, likes: 200 },
    { content_type: 'reel', published_at: '2026-08-09T00:00:00Z', views: 4000, reach: 1, likes: 80 },
    { content_type: 'reel', published_at: '2026-08-16T00:00:00Z', views: 400, reach: 1, likes: 30 },
    { content_type: 'static', published_at: '2026-08-11T00:00:00Z', reach: 2000, views: 9, likes: 50 },
    { content_type: 'static', published_at: '2026-08-18T00:00:00Z', reach: 1400, views: 9, likes: 46 },
    // last month — excluded
    { content_type: 'reel', published_at: '2026-07-11T00:00:00Z', views: 99_000, likes: 9999 },
  ]

  it('groups the month by type, most posts first', () => {
    const totals = typeTotals(rows, now)
    expect(totals.map(t => t.type)).toEqual(['reel', 'static'])
    expect(totals[0]).toMatchObject({ label: 'Reels', posts: 3, metric: 'views', value: 12_400, likes: 310 })
    expect(totals[1]).toMatchObject({ label: 'Graphics', posts: 2, metric: 'reach', value: 3400, likes: 96 })
  })

  it('reads back as the lines the portal prints', () => {
    expect(typeTotals(rows, now).map(typeTotalsLine)).toEqual([
      'Reels · 3 posts · 12.4k views · 310 likes',
      'Graphics · 2 posts · 3.4k reach · 96 likes',
    ])
  })

  it('never prints a raw database word for the type', () => {
    const line = typeTotalsLine(typeTotals(
      [{ content_type: 'static', published_at: '2026-08-11T00:00:00Z', reach: 10 }], now)[0])
    expect(line).toContain('Graphics')
    expect(line).not.toContain('static')
  })

  it('an unrecognised type still gets client words', () => {
    const [t] = typeTotals([{ content_type: 'whatever', published_at: '2026-08-11T00:00:00Z', reach: 10 }], now)
    expect(t.label).toBe('Other pieces')
  })

  it('falls back to whatever figure exists rather than reporting zero', () => {
    const [reel] = typeTotals(
      [{ content_type: 'reel', published_at: '2026-08-11T00:00:00Z', impressions: 700 }], now)
    expect(reel.value).toBe(700)
    const [still] = typeTotals(
      [{ content_type: 'static', published_at: '2026-08-11T00:00:00Z', impressions: 500 }], now)
    expect(still.value).toBe(500)
  })

  it('drops the count line for a type with no numbers yet, and keeps the post count', () => {
    const [t] = typeTotals([{ content_type: 'reel', published_at: '2026-08-11T00:00:00Z' }], now)
    expect(t.posts).toBe(1)
    expect(typeTotalsLine(t)).toBe('Reels · 1 post')
  })

  it('an empty month is an empty list', () => {
    expect(typeTotals([], now)).toEqual([])
    expect(typeTotalsLine(null)).toBeNull()
  })
})

describe('isStale — when to ask the provider again', () => {
  const now = Date.parse('2026-08-27T12:00:00.000Z')
  it('a row never synced is stale', () => {
    expect(isStale(null, now)).toBe(true)
    expect(isStale('rubbish', now)).toBe(true)
  })
  it('half an hour is the line', () => {
    expect(isStale(new Date(now - 29 * 60_000).toISOString(), now)).toBe(false)
    expect(isStale(new Date(now - 31 * 60_000).toISOString(), now)).toBe(true)
  })
})
