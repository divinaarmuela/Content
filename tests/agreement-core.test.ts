import { describe, expect, it } from 'vitest'
import {
  agreementMonthWindow, computeMonthlyProgress, effectiveQuotas, monthOfItem,
  normaliseDeliverableLines, normaliseServices, paceStatus,
} from '../app/lib/agreement-core'

describe('normaliseDeliverableLines', () => {
  it('accepts the Releeph shape and defaults labels', () => {
    const r = normaliseDeliverableLines([
      { type: 'static', monthly_qty: 20 },
      { type: 'reel', monthly_qty: 8, label: '' },
    ])
    expect(r).toEqual({
      lines: [
        { type: 'static', label: 'Graphics', monthly_qty: 20 },
        { type: 'reel', label: 'Reels', monthly_qty: 8 },
      ],
    })
  })

  it('rejects unknown types, duplicates, and non-integer quantities with a reason', () => {
    expect('error' in normaliseDeliverableLines([{ type: 'poster', monthly_qty: 3 }])).toBe(true)
    expect('error' in normaliseDeliverableLines([
      { type: 'reel', monthly_qty: 8 }, { type: 'reel', monthly_qty: 4 },
    ])).toBe(true)
    expect('error' in normaliseDeliverableLines([{ type: 'reel', monthly_qty: 2.5 }])).toBe(true)
    expect('error' in normaliseDeliverableLines([{ type: 'reel', monthly_qty: -1 }])).toBe(true)
  })

  it('treats junk as an empty agreement, not an error', () => {
    expect(normaliseDeliverableLines(undefined)).toEqual({ lines: [] })
    expect(normaliseDeliverableLines('nope')).toEqual({ lines: [] })
  })
})

describe('normaliseServices', () => {
  it('accepts catalog keys and custom entries, rejects invented keys', () => {
    const ok = normaliseServices([
      { key: 'manychat', label: 'ManyChat automation' },
      { key: 'custom:tiktok-ads', label: 'TikTok ads', note: 'from Oct', active: false },
    ])
    expect('services' in ok && ok.services[1]).toEqual(
      { key: 'custom:tiktok-ads', label: 'TikTok ads', note: 'from Oct', active: false })
    expect('error' in normaliseServices([{ key: 'freebies', label: 'x' }])).toBe(true)
    expect('error' in normaliseServices([{ key: 'manychat', label: ' ' }])).toBe(true)
  })
})

describe('effectiveQuotas', () => {
  const lines = [
    { type: 'static' as const, label: 'Graphics', monthly_qty: 20 },
    { type: 'reel' as const, label: 'Reels', monthly_qty: 8 },
  ]

  it('uses the agreement when no monthly override exists', () => {
    expect(effectiveQuotas(lines, null)).toEqual([
      { type: 'reel', label: 'Reels', quota: 8 },
      { type: 'static', label: 'Graphics', quota: 20 },
    ])
  })

  it('lets a commitments row override per type, partially', () => {
    const q = effectiveQuotas(lines, { static_quota: 25, reel_quota: 0, video_quota: 2 })
    expect(q).toEqual([
      { type: 'reel', label: 'Reels', quota: 8 },      // 0 override = not set
      { type: 'static', label: 'Graphics', quota: 25 }, // overridden
      { type: 'video', label: 'Video', quota: 2 },      // row-only type appears
    ])
  })

  it('a commitments row alone still yields quotas', () => {
    expect(effectiveQuotas([], { reel_quota: 4 })).toEqual([{ type: 'reel', label: 'Reels', quota: 4 }])
  })
})

describe('monthOfItem', () => {
  it('prefers the month it went live, then the shoot, then due date, then creation', () => {
    // shot in September, posted in November: November's delivery
    expect(monthOfItem({ published_at: '2026-11-03T10:00:00Z', due_date: '2026-10-02' }, { month: 9, year: 2026 }))
      .toEqual({ month: 11, year: 2026 })
    expect(monthOfItem({ due_date: '2026-10-02' }, { month: 9, year: 2026 }))
      .toEqual({ month: 9, year: 2026 })
    expect(monthOfItem({ due_date: '2026-10-02' }, null)).toEqual({ month: 10, year: 2026 })
    expect(monthOfItem({ created_at: '2026-12-31T23:00:00Z' }, null)).toEqual({ month: 12, year: 2026 })
    expect(monthOfItem({}, null)).toBeNull()
  })
})

describe('computeMonthlyProgress', () => {
  const quotas = [
    { type: 'static' as const, label: 'Graphics', quota: 20 },
    { type: 'reel' as const, label: 'Reels', quota: 8 },
  ]
  const batches = new Map([['b1', { month: 9, year: 2026 }]])

  it('delivered means LIVE, counted in the month it went live', () => {
    const items = [
      // September shoot, went live in September
      { content_type: 'reel', status: 'published', batch_id: 'b1', published_at: '2026-09-20T00:00:00Z' },
      // September shoot, still being edited — planned, not delivered
      { content_type: 'reel', status: 'draft_uploaded', batch_id: 'b1' },
      // approved but never posted — NOT delivered
      { content_type: 'static', status: 'approved_for_scheduling', due_date: '2026-09-15' },
      // scheduled but not live yet — NOT delivered
      { content_type: 'static', status: 'scheduled', due_date: '2026-09-16' },
      // August footage posted in September counts to September
      { content_type: 'static', status: 'published', due_date: '2026-08-15', published_at: '2026-09-02T00:00:00Z' },
      // a different month — excluded
      { content_type: 'static', status: 'published', published_at: '2026-08-15T00:00:00Z' },
    ]
    expect(computeMonthlyProgress(items, batches, 9, 2026, quotas)).toEqual([
      { type: 'static', label: 'Graphics', quota: 20, planned: 3, delivered: 1 },
      { type: 'reel', label: 'Reels', quota: 8, planned: 2, delivered: 1 },
    ])
  })
})

describe('paceStatus', () => {
  it('is met once the whole quota is delivered', () => {
    expect(paceStatus(10, 10, 15, 30)).toBe('met')
    expect(paceStatus(11, 10, 15, 30)).toBe('met')
    expect(paceStatus(0, 0, 15, 30)).toBe('met') // nothing promised
  })
  it('flags behind vs on-track against the linear burn-down', () => {
    // day 15/30 → expected 5 of 10
    expect(paceStatus(6, 10, 15, 30)).toBe('on_track')
    expect(paceStatus(5, 10, 15, 30)).toBe('on_track')
    expect(paceStatus(4, 10, 15, 30)).toBe('tight')   // >=75% of expected 5
    expect(paceStatus(2, 10, 15, 30)).toBe('behind')  // <75% of expected
  })
  it('does not cry behind at the very start of the month', () => {
    expect(paceStatus(0, 10, 0, 30)).toBe('on_track')
  })
})

describe('agreementMonthWindow', () => {
  const sept = { day: 20, daysInMonth: 30 }
  it('no start date (or garbage) = live all month', () => {
    expect(agreementMonthWindow(null, 9, 2026, sept)).toEqual({ dayOfMonth: 20, daysInMonth: 30 })
    expect(agreementMonthWindow('soon', 9, 2026, sept)).toEqual({ dayOfMonth: 20, daysInMonth: 30 })
  })
  it('started in an earlier month = live all month', () => {
    expect(agreementMonthWindow('2026-08-15', 9, 2026, sept)).toEqual({ dayOfMonth: 20, daysInMonth: 30 })
    expect(agreementMonthWindow('2025-12-01', 9, 2026, sept)).toEqual({ dayOfMonth: 20, daysInMonth: 30 })
  })
  it('starts after this month = null, nothing owed', () => {
    expect(agreementMonthWindow('2026-10-01', 9, 2026, sept)).toBeNull()
    expect(agreementMonthWindow('2027-01-01', 9, 2026, sept)).toBeNull()
  })
  it('signed mid-month: measured over the remaining days only', () => {
    // signed the 16th of a 30-day month, today the 20th → 5 of 15 days elapsed
    expect(agreementMonthWindow('2026-09-16', 9, 2026, sept)).toEqual({ dayOfMonth: 5, daysInMonth: 15 })
    // signed today → 1 elapsed day of the 11 remaining, never negative
    expect(agreementMonthWindow('2026-09-20', 9, 2026, sept)).toEqual({ dayOfMonth: 1, daysInMonth: 11 })
    // signed later this month but not yet reached → 0 elapsed
    expect(agreementMonthWindow('2026-09-25', 9, 2026, sept)).toEqual({ dayOfMonth: 0, daysInMonth: 6 })
  })
  it('the signing day itself is never behind', () => {
    const w = agreementMonthWindow('2026-09-20', 9, 2026, sept)!
    expect(paceStatus(0, 10, w.dayOfMonth, w.daysInMonth)).toBe('on_track')
  })
})
