import { describe, it, expect } from 'vitest'
import {
  accountIdsOf, boardLine, buildPerformance, dayKey, followersLine, followersNote,
  followersOn, followersSince, followersSinceAttributed, hasNumbers, interactionsOf,
  nextPostAfter, noNumbersLine, performanceLine, platformChips, portalFollowersLine,
  portalLine, portalPerformance, readPerformance, shapeComments, shapeFollowerStats,
  shapeTimeline, shownFollowers, signed, sparkPath, summariseTimeline,
} from '../app/lib/post-performance-core'

/**
 * "How it did" — the maths, against the provider's REAL shapes.
 *
 * The follower-stats and post-timeline bodies below are captured from the
 * live API on the one connected test account (7 Sep 2026), with the zeros
 * replaced by numbers a test can see move.
 */

const TZ = 'Australia/Melbourne'

/** the provider's follower series, as `/accounts/follower-stats` sends it */
const SERIES = [
  { date: '2026-08-30', followers: 100 },
  { date: '2026-08-31', followers: 102 },
  { date: '2026-09-01', followers: 110 },
  { date: '2026-09-02', followers: 115 },
  { date: '2026-09-03', followers: 115 },
  { date: '2026-09-04', followers: 121 },
  { date: '2026-09-05', followers: 121 },
  { date: '2026-09-06', followers: 127 },
]
/** "today" for the tests: 6 Sep, mid-afternoon in Melbourne */
const NOW = new Date('2026-09-06T05:00:00.000Z')

describe('dayKey', () => {
  it('is the day in the agency zone, not UTC', () => {
    // 15:30 UTC on the 1st is 01:30 on the 2nd in Melbourne (AEST, +10)
    expect(dayKey('2026-09-01T15:30:00.000Z', TZ)).toBe('2026-09-02')
    expect(dayKey('2026-09-01T10:00:00.000Z', TZ)).toBe('2026-09-01')
  })
  it('is null for garbage', () => {
    expect(dayKey('not a date', TZ)).toBeNull()
    expect(dayKey(null, TZ)).toBeNull()
  })
})

describe('followersOn', () => {
  it('takes the point on the day, or the nearest before it', () => {
    expect(followersOn(SERIES, '2026-09-02')?.followers).toBe(115)
    expect(followersOn([SERIES[0], SERIES[3]], '2026-09-01')?.followers).toBe(100)
  })
  it('has no answer before the series began', () => {
    expect(followersOn(SERIES, '2026-08-01')).toBeNull()
  })
})

describe('followersSince', () => {
  it("is today's count minus the count on the post's day", () => {
    const d = followersSince(SERIES, '2026-09-01T02:00:00.000Z', TZ, NOW)
    expect(d).toMatchObject({ delta: 17, from: 110, to: 127, fromDate: '2026-09-01', toDate: '2026-09-06', until: 'now' })
  })
  it('is zero on the day it went up, not null', () => {
    const d = followersSince(SERIES, '2026-09-06T01:00:00.000Z', TZ, NOW)
    expect(d?.delta).toBe(0)
  })
  it('is null with no series, and null for a post from before tracking began', () => {
    expect(followersSince([], '2026-09-01T02:00:00.000Z', TZ, NOW)).toBeNull()
    expect(followersSince(null, '2026-09-01T02:00:00.000Z', TZ, NOW)).toBeNull()
    expect(followersSince(SERIES, '2026-08-01T02:00:00.000Z', TZ, NOW)).toBeNull()
  })
  it('drops rows the provider mangled rather than throwing', () => {
    const dirty = [...SERIES, { date: 'nope', followers: 5 }, { date: '2026-09-07', followers: 'x' as unknown as number }]
    expect(followersSince(dirty, '2026-09-01T02:00:00.000Z', TZ, NOW)?.delta).toBe(17)
  })
})

describe('followersSinceAttributed', () => {
  it('closes the window on the day of the next post', () => {
    const d = followersSinceAttributed(SERIES, '2026-09-01T02:00:00.000Z', '2026-09-04T02:00:00.000Z', TZ, NOW)
    expect(d).toMatchObject({ delta: 11, from: 110, to: 121, toDate: '2026-09-04', until: 'next_post' })
  })
  it('two posts a day apart never claim the same gain', () => {
    const first = followersSinceAttributed(SERIES, '2026-09-01T02:00:00.000Z', '2026-09-02T02:00:00.000Z', TZ, NOW)
    const second = followersSinceAttributed(SERIES, '2026-09-02T02:00:00.000Z', null, TZ, NOW)
    expect(first?.delta).toBe(5)       // 110 → 115
    expect(second?.delta).toBe(12)     // 115 → 127
    expect(first!.delta + second!.delta).toBe(17)
  })
  it('is the open window when there is no next post, or it is today', () => {
    expect(followersSinceAttributed(SERIES, '2026-09-01T02:00:00.000Z', null, TZ, NOW)?.until).toBe('now')
    expect(followersSinceAttributed(SERIES, '2026-09-01T02:00:00.000Z', '2026-09-06T02:00:00.000Z', TZ, NOW)?.until).toBe('now')
  })
  it('two posts on one day: the earlier claims zero, the later the gain — still an answer', () => {
    const d = followersSinceAttributed(SERIES, '2026-09-01T02:00:00.000Z', '2026-09-01T06:00:00.000Z', TZ, NOW)
    expect(d).toMatchObject({ delta: 0, until: 'next_post', fromDate: '2026-09-01', toDate: '2026-09-01' })
  })
})

describe('interactionsOf', () => {
  it('sums likes + comments + shares + saves, with the parts', () => {
    const i = interactionsOf({ likes: 30, comments: 4, shares: 6, saves: 2, views: 900 })
    expect(i.total).toBe(42)
    expect(i.parts.map(p => p.key)).toEqual(['likes', 'comments', 'shares', 'saves'])
  })
  it('a platform with no saves (TikTok) sums what it has', () => {
    const i = interactionsOf({ likes: 10, comments: 2, shares: 1, saves: null })
    expect(i.total).toBe(13)
    expect(i.parts).toHaveLength(3)
  })
  it('nothing reported is null, not zero', () => {
    expect(interactionsOf(null).total).toBeNull()
    expect(interactionsOf({ likes: null, comments: null }).total).toBeNull()
  })
})

describe('platformChips', () => {
  it('Instagram gets all six; TikTok has no reach or saves; YouTube has no shares', () => {
    const m = { likes: 1, comments: 2, shares: 3, saves: 4, reach: 5, views: 6, impressions: 7 }
    expect(platformChips(m, 'instagram').map(c => c.key)).toEqual(['likes', 'comments', 'shares', 'saves', 'reach', 'views'])
    expect(platformChips(m, 'tiktok').map(c => c.key)).toEqual(['likes', 'comments', 'shares', 'views'])
    expect(platformChips(m, 'youtube').map(c => c.key)).toEqual(['likes', 'comments', 'views'])
    expect(platformChips(m, 'linkedin').map(c => c.key)).toEqual(['likes', 'comments', 'shares', 'reach'])
  })
  it('views falls back to impressions on a still, and a null is not a chip', () => {
    expect(platformChips({ impressions: 300, likes: null }, 'instagram')).toEqual([{ key: 'views', label: 'views', value: 300 }])
  })
})

describe('shapeTimeline + summariseTimeline', () => {
  /** the live body's shape, one row per day, with numbers */
  const RAW = {
    postId: '6a8fbd6e815b02c9e6c38c8a',
    timeline: [
      { date: '2026-08-27', platform: 'instagram', platformPostId: '1', impressions: 100, reach: 90, likes: 5, comments: 1, shares: 0, saves: 1, clicks: 0, views: 0, follows: 0 },
      { date: '2026-08-28', platform: 'instagram', platformPostId: '1', impressions: 50, reach: 40, likes: 3, comments: 0, shares: 1, saves: 0, clicks: 0, views: 0, follows: 0 },
      { date: '2026-08-29', platform: 'instagram', platformPostId: '1', impressions: 10, reach: 8, likes: 1, comments: 0, shares: 0, saves: 0, clicks: 0, views: 0, follows: 0 },
    ],
  }
  it('reads the rows and sorts them', () => {
    const rows = shapeTimeline({ ...RAW, timeline: [...RAW.timeline].reverse() })
    expect(rows.map(r => r.date)).toEqual(['2026-08-27', '2026-08-28', '2026-08-29'])
    expect(rows[0].likes).toBe(5)
  })
  it('daily counts accumulate into a running total for the sparkline', () => {
    const s = summariseTimeline(shapeTimeline(RAW), { likes: 9, comments: 1, shares: 1, saves: 1 })
    expect(s.mode).toBe('daily')
    expect(s.days).toBe(3)
    expect(s.series.map(p => p.value)).toEqual([7, 11, 12])
    expect(s.seen.map(p => p.value)).toEqual([100, 150, 160])
  })
  it('snapshots of the running total are read as they are', () => {
    const snap = {
      timeline: [
        { date: '2026-08-27', likes: 5, comments: 1, impressions: 100 },
        { date: '2026-08-28', likes: 8, comments: 1, impressions: 150 },
        { date: '2026-08-29', likes: 9, comments: 3, impressions: 160 },
      ],
    }
    const s = summariseTimeline(shapeTimeline(snap), { likes: 9, comments: 3, shares: 0, saves: 0 })
    expect(s.mode).toBe('cumulative')
    expect(s.series.map(p => p.value)).toEqual([6, 9, 12])
  })
  it('folds several platforms on one day together, and caps at thirty points', () => {
    const many = { timeline: Array.from({ length: 40 }, (_, i) => ({
      date: `2026-07-${String(1 + (i % 20)).padStart(2, '0')}`, platform: i < 20 ? 'instagram' : 'tiktok', likes: 1,
    })) }
    const s = summariseTimeline(shapeTimeline(many))
    expect(s.days).toBe(20)
    expect(s.series[0].value).toBe(2)
    const long = { timeline: Array.from({ length: 45 }, (_, i) => ({ date: new Date(Date.UTC(2026, 5, 1 + i)).toISOString(), likes: 1 })) }
    expect(summariseTimeline(shapeTimeline(long)).series).toHaveLength(30)
  })
  it('a post with no data yet is an empty series, not a throw', () => {
    expect(summariseTimeline(shapeTimeline(null))).toEqual({ days: 0, series: [], seen: [], mode: 'daily' })
    expect(summariseTimeline(shapeTimeline({ error: 'Analytics add-on required' })).days).toBe(0)
  })
})

describe('shapeComments', () => {
  it('reads name + text the way the Inbox does, newest first, capped, hidden dropped', () => {
    const raw = { data: [
      { id: 'c1', text: 'Love this', username: 'ana', createdTime: '2026-09-01T00:00:00Z' },
      { id: 'c2', message: 'Where is this?', from: { username: 'ben' }, timestamp: '2026-09-03T00:00:00Z' },
      { id: 'c3', text: 'spam', username: 'bot', hidden: true },
      { id: 'c4', text: '', username: 'mute' },
      ...Array.from({ length: 12 }, (_, i) => ({ id: `x${i}`, text: `hi ${i}`, createdTime: '2026-08-01T00:00:00Z' })),
    ] }
    const out = shapeComments(raw)
    expect(out).toHaveLength(10)
    expect(out[0]).toMatchObject({ id: 'c2', author: 'ben', text: 'Where is this?' })
    expect(out[1]).toMatchObject({ id: 'c1', author: 'ana' })
    expect(out.some(c => c.id === 'c3' || c.id === 'c4')).toBe(false)
    expect(out.find(c => c.id === 'x0')?.author).toBe('someone')
  })
  it('accepts a bare array or nothing', () => {
    expect(shapeComments([{ id: 'a', text: 'b' }])).toHaveLength(1)
    expect(shapeComments(null)).toEqual([])
  })
})

describe('shapeFollowerStats', () => {
  /** the live body, trimmed */
  const RAW = {
    accounts: [
      { _id: '6a6dd609df17280d93884dda', platform: 'instagram', username: 'testbusinessaccount2026', currentFollowers: 127.0, growth: 27.0 },
      { _id: '6a94d2ba77555aae0127560e', platform: 'youtube', currentFollowers: 3.0 },
    ],
    stats: {
      '6a6dd609df17280d93884dda': SERIES,
      '6a94d2ba77555aae0127560e': [{ date: '2026-09-06', followers: 3.0 }],
    },
    dateRange: { from: '2026-08-25T00:00:00Z', to: '2026-09-07T23:59:59.999000Z' },
    granularity: 'daily',
  }
  it('keys series and current counts by account id', () => {
    const s = shapeFollowerStats(RAW)
    expect(s.series.get('6a6dd609df17280d93884dda')).toHaveLength(8)
    expect(s.current.get('6a6dd609df17280d93884dda')).toBe(127)
    expect(s.current.get('6a94d2ba77555aae0127560e')).toBe(3)
  })
  it('is empty for the add-on refusal, not a throw', () => {
    const s = shapeFollowerStats({ error: 'Analytics add-on required', requiresAddon: true })
    expect(s.series.size).toBe(0)
  })
})

describe('nextPostAfter', () => {
  const ig = [{ platform: 'instagram', accountId: 'acc-ig' }]
  const li = [{ platform: 'linkedin', accountId: 'acc-li' }]
  const job = { id: 'j1', published_at: '2026-09-01T02:00:00.000Z', targets: ig }
  it('is the earliest later post on the same account', () => {
    const others = [
      { id: 'j2', published_at: '2026-09-04T02:00:00.000Z', targets: ig },
      { id: 'j3', published_at: '2026-09-02T02:00:00.000Z', targets: ig },
      { id: 'j0', published_at: '2026-08-30T02:00:00.000Z', targets: ig },
    ]
    expect(nextPostAfter(job, [job, ...others])).toBe('2026-09-02T02:00:00.000Z')
  })
  it('a post on another account does not close the window', () => {
    expect(nextPostAfter(job, [{ id: 'j2', published_at: '2026-09-02T02:00:00.000Z', targets: li }])).toBeNull()
  })
  it('accountIdsOf tolerates whatever the column holds', () => {
    expect(accountIdsOf(null)).toEqual([])
    expect(accountIdsOf([{ accountId: 'a' }, {}, null])).toEqual(['a'])
  })
})

describe('buildPerformance + the words', () => {
  const metrics = { likes: 30, comments: 4, shares: 6, saves: 2, reach: 1830, views: null, impressions: 2100 }
  const p = buildPerformance({
    metrics, platform: 'instagram', postedAt: '2026-09-01T02:00:00.000Z',
    nextPostAt: '2026-09-04T02:00:00.000Z',
    timeline: shapeTimeline({ timeline: [{ date: '2026-09-01', likes: 20 }, { date: '2026-09-02', likes: 10, comments: 4, shares: 6, saves: 2 }] }),
    followers: SERIES, comments: shapeComments([{ id: 'c', text: 'nice', username: 'ana' }]),
    providerPostId: 'post-1', tz: TZ, now: NOW,
  })
  it('carries both follower windows and shows the attributed one', () => {
    expect(p.followers_since?.delta).toBe(17)
    expect(p.followers_until_next?.delta).toBe(11)
    expect(shownFollowers(p)?.until).toBe('next_post')
  })
  it('the plain-words lines', () => {
    expect(performanceLine(p)).toBe('42 people interacted · reach 1,830 · +11 followers until next post')
    expect(boardLine(p)).toBe('42 interactions · +11 followers')
    expect(portalLine(p)).toBe('42 people interacted · +11 followers until the next post')
    expect(followersLine(p.followers_since)).toBe('+17 followers since this post')
    expect(followersLine(p.followers_until_next)).toBe('+11 followers until your next post')
    expect(followersNote(p.followers_until_next)).toMatch(/never share a gain/)
    expect(followersLine({ delta: -1, from: 2, to: 1, fromDate: '', toDate: '', until: 'now' })).toBe('−1 follower since this post')
    expect(signed(0)).toBe('0')
  })
  it('a post with no data yet: no numbers, an honest sentence, never a throw', () => {
    const empty = buildPerformance({ metrics: null, platform: 'instagram', postedAt: null, tz: TZ, now: NOW })
    expect(hasNumbers(empty)).toBe(false)
    expect(performanceLine(empty)).toBeNull()
    expect(boardLine(empty)).toBeNull()
    expect(portalPerformance(empty)).toBeNull()
    expect(noNumbersLine('instagram')).toBe('No numbers yet — Instagram usually reports within a day.')
    expect(noNumbersLine(null)).toBe('No numbers yet — The platform usually reports within a day.')
  })
  it('a TikTok post with no reach still has a line', () => {
    const tt = buildPerformance({
      metrics: { likes: 10, comments: 2, shares: 1, views: 500, reach: null, saves: null },
      platform: 'tiktok', postedAt: '2026-09-05T02:00:00.000Z', followers: SERIES, tz: TZ, now: NOW,
    })
    expect(tt.chips.map(c => c.key)).toEqual(['likes', 'comments', 'shares', 'views'])
    expect(performanceLine(tt)).toBe('13 people interacted · views 500 · +6 followers since')
  })
  it('the portal slice carries no names and no ids', () => {
    const slice = portalPerformance(p)!
    expect(slice).toEqual({
      interactions: 42, followers: { delta: 11, until: 'next_post' },
      spark: [{ date: '2026-09-01', value: 20 }, { date: '2026-09-02', value: 42 }],
    })
    expect(JSON.stringify(slice)).not.toMatch(/ana|post-1/)
    expect(portalFollowersLine(slice.followers)).toBe('+11 followers between this post and the next')
  })
  it('reads itself back from the row, and refuses a stranger', () => {
    expect(readPerformance(JSON.parse(JSON.stringify(p)))).toEqual(p)
    expect(readPerformance(null)).toBeNull()
    expect(readPerformance({ raw: true })).toBeNull()
    // a row from before the comments field: still readable
    const { comments: _c, ...older } = p
    expect(readPerformance(older)?.comments).toEqual([])
  })
})

describe('sparkPath', () => {
  it('draws a line across the box, low to high, and a closed area under it', () => {
    const { line, area, last } = sparkPath([0, 5, 10], 100, 20, 0)
    expect(line).toBe('M0 20 L50 10 L100 0')
    expect(area).toBe('M0 20 L50 10 L100 0 L100 20 L0 20 Z')
    expect(last).toEqual({ x: 100, y: 0 })
  })
  it('a flat series sits on the baseline rather than dividing by zero', () => {
    expect(sparkPath([3, 3], 10, 10, 0).line).toBe('M0 10 L10 10')
    expect(sparkPath([], 10, 10).line).toBe('')
  })
})
