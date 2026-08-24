import { describe, expect, it } from 'vitest'
import { openSlots, minToLabel, labelToMin } from '../app/lib/booking-core'

describe('openSlots', () => {
  it('tiles a window by duration and drops taken + past slots', () => {
    // 9:00–11:00 (540–660), 30-min service
    const slots = openSlots({
      windows: [{ start_min: 540, end_min: 660 }],
      durationMin: 30,
      takenMins: [600],           // 10:00 taken
      nowMin: 555,                // it's 9:15 → 9:00 slot is gone
    })
    // candidates 540,570,600,630 → drop 540 (past), 600 (taken) → 570,630
    expect(slots).toEqual([570, 630])
  })

  it('a slot must fit fully inside the window', () => {
    // 9:00–9:50, 30-min: only 9:00 and 9:20... 9:20+30=9:50 fits; 9:30 would end 10:00 > window
    const slots = openSlots({ windows: [{ start_min: 540, end_min: 590 }], durationMin: 30, stepMin: 20, takenMins: [] })
    expect(slots).toEqual([540, 560])
  })

  it('merges multiple windows and dedupes/sorts', () => {
    const slots = openSlots({
      windows: [{ start_min: 600, end_min: 660 }, { start_min: 540, end_min: 600 }],
      durationMin: 60, takenMins: [],
    })
    expect(slots).toEqual([540, 600])
  })

  it('rejects bad rows and zero/negative durations', () => {
    expect(openSlots({ windows: [{ start_min: 660, end_min: 540 }], durationMin: 30, takenMins: [] })).toEqual([])
    expect(openSlots({ windows: [{ start_min: 540, end_min: 660 }], durationMin: 0, takenMins: [] })).toEqual([])
  })
})

describe('minToLabel / labelToMin round-trip', () => {
  it('formats and parses', () => {
    expect(minToLabel(570)).toBe('9:30 am')
    expect(minToLabel(0)).toBe('12:00 am')
    expect(minToLabel(720)).toBe('12:00 pm')
    expect(minToLabel(1350)).toBe('10:30 pm')
    expect(labelToMin('9:30 am')).toBe(570)
    expect(labelToMin('12:00 pm')).toBe(720)
    expect(labelToMin('10:30 pm')).toBe(1350)
    expect(labelToMin('nonsense')).toBeNull()
  })
})
