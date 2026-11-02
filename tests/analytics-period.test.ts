import { describe, expect, it } from 'vitest'
import { inRange, periodRange, rangeWords } from '../app/lib/analytics-period-core'

describe('the analytics page’s weeks (2 Nov 2026)', () => {
  it('this week runs Monday to today; last week the Monday to Sunday before', () => {
    // Mon 2 Nov 2026
    expect(periodRange('this_week', '2026-11-02')).toEqual({ from: '2026-11-02', to: '2026-11-02' })
    expect(periodRange('last_week', '2026-11-02')).toEqual({ from: '2026-10-26', to: '2026-11-01' })
    // Sun 8 Nov 2026 is still the same week
    expect(periodRange('this_week', '2026-11-08')).toEqual({ from: '2026-11-02', to: '2026-11-08' })
    expect(periodRange('all', '2026-11-08')).toBeNull()
  })
  it('reads the range in words, and keeps only its days', () => {
    expect(rangeWords({ from: '2026-10-26', to: '2026-11-01' })).toBe('26 Oct – 1 Nov')
    expect(inRange('2026-10-30', { from: '2026-10-26', to: '2026-11-01' })).toBe(true)
    expect(inRange('2026-11-02', { from: '2026-10-26', to: '2026-11-01' })).toBe(false)
    expect(inRange(null, null)).toBe(true)
  })
})
