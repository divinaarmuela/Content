import { describe, expect, it } from 'vitest'
import { formatCallTime, parseCallTime } from '../app/lib/shoot-sop-core'

describe('call time, picked not typed (13 Sep 2026)', () => {
  it('reads what the team has typed before', () => {
    expect(parseCallTime('7:30 am')).toEqual({ hour: 7, minute: 30, period: 'am' })
    expect(parseCallTime('07:30')).toEqual({ hour: 7, minute: 30, period: 'am' })
    expect(parseCallTime('19:30')).toEqual({ hour: 7, minute: 30, period: 'pm' })
    expect(parseCallTime('7.30AM')).toEqual({ hour: 7, minute: 30, period: 'am' })
    expect(parseCallTime('12 pm')).toEqual({ hour: 12, minute: 0, period: 'pm' })
    expect(parseCallTime('early')).toBeNull()
    expect(parseCallTime('')).toBeNull()
    expect(parseCallTime('13 pm')).toBeNull()
  })
  it('writes the one form the plan, the reminder and the PDF carry', () => {
    expect(formatCallTime({ hour: 7, minute: 5, period: 'am' })).toBe('7:05 am')
    expect(formatCallTime(parseCallTime('19:30')!)).toBe('7:30 pm')
  })
})
