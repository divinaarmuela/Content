import { describe, it, expect } from 'vitest'
import { monthState, settlesOn, melbourneDay } from '../app/lib/client-report-core'

// 2 Nov 2026, the owner: "can we specify this in the report dashboard" (how fresh Zernio's numbers are), and Jordan
// Wilson's November-so-far read "−96% views vs last month" — one day against a whole month.

describe('how settled a month’s figures are', () => {
  it('a month settles two days after its last day', () => {
    expect(settlesOn('2026-10')).toBe('2026-11-02')
    expect(settlesOn('2026-12')).toBe('2027-01-02')
    expect(settlesOn('2026-02')).toBe('2026-03-02')
  })
  it('running while the month lasts, settling for two days, then final', () => {
    expect(monthState('2026-11', '2026-11-02').kind).toBe('running')
    expect(monthState('2026-10', '2026-10-31').kind).toBe('running')
    expect(monthState('2026-10', '2026-11-01').kind).toBe('settling')
    expect(monthState('2026-10', '2026-11-02').kind).toBe('final')
  })
  it('a final month read before it settled says so, so it is read again', () => {
    expect(monthState('2026-10', '2026-11-05', '2026-10-31T23:00:00Z')).toEqual({ kind: 'final', settlesOn: '2026-11-02', readEarly: true })
    expect(monthState('2026-10', '2026-11-05', '2026-11-03T01:00:00Z')).toEqual({ kind: 'final', settlesOn: '2026-11-02', readEarly: false })
  })
  it('days are Melbourne days', () => {
    expect(melbourneDay(new Date('2026-11-01T14:00:00Z'))).toBe('2026-11-02')
  })
})
