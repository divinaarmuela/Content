import { describe, it, expect } from 'vitest'
import {
  buildMonthRow, buildMonthRows, expandLine, expandSummary, monthKeyOf,
  monthStatusLabel, monthStatusOf, shortfallOf, sortRank, sumMonthViews,
  type MonthTypeLine,
} from '../app/lib/overview-month-core'
import type { PaceStatus } from '../app/lib/agreement-core'

const line = (
  type: string, label: string, promised: number, posted: number, pace: PaceStatus,
  extra: Partial<MonthTypeLine> = {},
): MonthTypeLine => ({
  type, label, promised, posted, scheduled: 0, in_production: 0, pace, ...extra,
})

describe('monthKeyOf', () => {
  it('pads to the key melbourneMonthKey produces', () => {
    expect(monthKeyOf(8, 2026)).toBe('2026-08')
    expect(monthKeyOf(12, 2026)).toBe('2026-12')
  })
})

describe('status derivation', () => {
  it('is met when every type posted its whole promise', () => {
    const lines = [line('reel', 'Reels', 4, 4, 'met'), line('static', 'Graphics', 3, 5, 'met')]
    expect(monthStatusOf(lines)).toBe('met')
    expect(shortfallOf(lines)).toBe(0)
  })

  it('is met when nothing was promised — you cannot be short of nothing', () => {
    expect(monthStatusOf([])).toBe('met')
  })

  it('is short when any line is behind pace', () => {
    const lines = [line('reel', 'Reels', 4, 1, 'behind'), line('static', 'Graphics', 3, 3, 'met')]
    expect(monthStatusOf(lines)).toBe('short')
    expect(shortfallOf(lines)).toBe(3)
  })

  it('is at risk when the worst line is only tight', () => {
    const lines = [line('reel', 'Reels', 4, 2, 'tight'), line('static', 'Graphics', 3, 3, 'met')]
    expect(monthStatusOf(lines)).toBe('at_risk')
  })

  it('is on track when work is outstanding but pace is fine', () => {
    const lines = [line('reel', 'Reels', 4, 2, 'on_track'), line('static', 'Graphics', 3, 3, 'met')]
    expect(monthStatusOf(lines)).toBe('on_track')
  })

  it('one bad type is never hidden by five good ones', () => {
    const lines = [
      line('static', 'Graphics', 3, 3, 'met'),
      line('carousel', 'Carousels', 2, 2, 'met'),
      line('reel', 'Reels', 4, 0, 'behind'),
    ]
    expect(monthStatusOf(lines)).toBe('short')
  })

  it('does not report met on a shortfall a stale pace calls met', () => {
    // pace is computed against the calendar; the strict "posted >= promised"
    // reading wins, so an unfinished month can never say Met
    const lines = [line('reel', 'Reels', 4, 3, 'met')]
    expect(monthStatusOf(lines)).toBe('on_track')
  })

  it('labels the shortfall with its number', () => {
    expect(monthStatusLabel('short', 3)).toBe('Short by 3')
    expect(monthStatusLabel('short', 0)).toBe('Short')
    expect(monthStatusLabel('met', 0)).toBe('Met')
    expect(monthStatusLabel('on_track', 2)).toBe('On track')
    expect(monthStatusLabel('at_risk', 2)).toBe('At risk')
  })
})

describe('per-type expand', () => {
  it('reads posted over promised, in the agreement label', () => {
    expect(expandLine(line('reel', 'Reels', 4, 2, 'tight'))).toBe('Reels 2/4')
  })

  it('joins the whole promise with the separator the dashboard uses', () => {
    expect(expandSummary([
      line('reel', 'Reels', 4, 2, 'tight'),
      line('static', 'Graphics', 3, 3, 'met'),
    ])).toBe('Reels 2/4 · Graphics 3/3')
  })

  it('is empty, not broken, for a client with no lines', () => {
    expect(expandSummary([])).toBe('')
  })
})

describe('views for the month', () => {
  const KEY = '2026-08'
  // 2026-08-01T00:30Z is 10:30am on the 1st in Melbourne; 2026-07-31T20:00Z
  // is already 6am on 1 August there — the month boundary is the agency's
  const inMonth = '2026-08-10T02:00:00.000Z'

  it('is null when there are no analytics rows at all', () => {
    expect(sumMonthViews([], KEY)).toBeNull()
    expect(sumMonthViews(undefined, KEY)).toBeNull()
  })

  it('is null when every row in the month is still pending', () => {
    expect(sumMonthViews([
      { content_type: 'reel', published_at: inMonth, views: null, reach: null, impressions: null },
    ], KEY)).toBeNull()
  })

  it('sums views for reels and reach for stills', () => {
    expect(sumMonthViews([
      { content_type: 'reel', published_at: inMonth, views: 1000, reach: 400 },
      { content_type: 'static', published_at: inMonth, views: 9999, reach: 250 },
    ], KEY)).toBe(1250)
  })

  it('falls back to impressions rather than reporting nothing', () => {
    expect(sumMonthViews([
      { content_type: 'reel', published_at: inMonth, views: null, impressions: 300 },
      { content_type: 'carousel', published_at: inMonth, reach: null, impressions: 120 },
    ], KEY)).toBe(420)
  })

  it('skips nulls without dragging the total to zero', () => {
    expect(sumMonthViews([
      { content_type: 'reel', published_at: inMonth, views: 500 },
      { content_type: 'reel', published_at: inMonth, views: null },
    ], KEY)).toBe(500)
  })

  it('ignores posts from another month and rows with no publish time', () => {
    expect(sumMonthViews([
      { content_type: 'reel', published_at: '2026-07-10T02:00:00.000Z', views: 900 },
      { content_type: 'reel', published_at: null, views: 900 },
      { content_type: 'reel', published_at: inMonth, views: 40 },
    ], KEY)).toBe(40)
  })

  it('counts a post by the Melbourne month, not UTC', () => {
    // 31 July 20:00 UTC is 1 August 06:00 in Melbourne — August's post
    expect(sumMonthViews([
      { content_type: 'reel', published_at: '2026-07-31T20:00:00.000Z', views: 77 },
    ], KEY)).toBe(77)
  })
})

describe('buildMonthRow', () => {
  const KEY = '2026-08'
  const inAug = '2026-08-10T02:00:00.000Z'

  it('totals the promise across types and carries the expand lines', () => {
    const row = buildMonthRow({
      id: 'c1', name: 'Acme', has_agreement: true,
      lines: [
        line('reel', 'Reels', 4, 2, 'tight', { scheduled: 1, in_production: 1 }),
        line('static', 'Graphics', 3, 3, 'met'),
      ],
      last_post: { at: inAug, item_id: 'i1' },
      analytics: [{ content_type: 'reel', published_at: inAug, views: 1200 }],
    }, KEY)
    expect(row.promised).toBe(7)
    expect(row.posted).toBe(5)
    expect(row.scheduled).toBe(1)
    expect(row.in_production).toBe(1)
    expect(row.status).toBe('at_risk')
    expect(row.status_label).toBe('At risk')
    expect(row.short_by).toBe(2)
    expect(row.views).toBe(1200)
    expect(row.last_post?.item_id).toBe('i1')
  })

  it('counts a row’s month on that client’s own calendar', () => {
    // 2026-09-01T01:00Z is 9 am on 1 September in Manila and still 6 pm on
    // 31 August in Los Angeles. The table spans zones, so “this month” is a
    // per-row question and each row has to answer it for its own client.
    const boundary = '2026-09-01T01:00:00.000Z'
    const input = {
      id: 'c9', name: 'Boundary Co', has_agreement: false,
      analytics: [{ content_type: 'reel', published_at: boundary, views: 500 }],
    }
    expect(buildMonthRow({ ...input, tz: 'America/Los_Angeles' }, KEY).views).toBe(500)
    expect(buildMonthRow({ ...input, tz: 'Asia/Manila' }, KEY).views).toBeNull()
    // and the zone travels out on the row, so whoever renders its dates uses it
    expect(buildMonthRow({ ...input, tz: 'Asia/Manila' }, KEY).tz).toBe('Asia/Manila')
    expect(buildMonthRow(input, KEY).tz).toBe('Australia/Melbourne')
  })

  it('treats an agreement with no lines as no agreement on file', () => {
    const row = buildMonthRow({ id: 'c2', name: 'Empty Co', has_agreement: true, lines: [] }, KEY)
    expect(row.has_agreement).toBe(false)
    expect(row.promised).toBe(0)
    expect(row.views).toBeNull()
    expect(row.last_post).toBeNull()
  })

  it('keeps a not-yet-started agreement out of trouble', () => {
    const row = buildMonthRow({
      id: 'c3', name: 'New Co', has_agreement: true, not_started: true,
      lines: [line('reel', 'Reels', 4, 0, 'met')],
    }, KEY)
    expect(row.not_started).toBe(true)
    // paceStatus already returns 'met' for a window that has not opened, but
    // the strict posted>=promised reading still names the gap
    expect(row.short_by).toBe(4)
  })
})

describe('sorting', () => {
  const KEY = '2026-08'
  const client = (name: string, promised: number, posted: number, pace: PaceStatus) => ({
    id: name, name, has_agreement: true, lines: [line('reel', 'Reels', promised, posted, pace)],
  })

  it('puts short and at-risk first, then on track, then met', () => {
    const rows = buildMonthRows([
      client('Delta', 4, 4, 'met'),
      client('Bravo', 4, 2, 'on_track'),
      client('Alpha', 4, 0, 'behind'),
      client('Charlie', 4, 1, 'tight'),
    ], KEY)
    expect(rows.map(r => r.name)).toEqual(['Alpha', 'Charlie', 'Bravo', 'Delta'])
    expect(rows.map(r => r.status)).toEqual(['short', 'at_risk', 'on_track', 'met'])
  })

  it('breaks ties by client name', () => {
    const rows = buildMonthRows([
      client('Zulu', 4, 0, 'behind'),
      client('Alpha', 9, 0, 'behind'),
    ], KEY)
    expect(rows.map(r => r.name)).toEqual(['Alpha', 'Zulu'])
  })

  it('drops the clients with no agreement to the bottom', () => {
    const rows = buildMonthRows([
      { id: 'n1', name: 'Aardvark Ltd', has_agreement: false },
      client('Zulu', 4, 4, 'met'),
    ], KEY)
    expect(rows.map(r => r.name)).toEqual(['Zulu', 'Aardvark Ltd'])
    expect(sortRank(rows[1])).toBe(4)
  })

  it('is stable on an empty list', () => {
    expect(buildMonthRows([], KEY)).toEqual([])
  })
})
