import { describe, it, expect } from 'vitest'
import {
  normaliseSettings, gmailQuery, blockedReason, DEFAULT_SCAN_SETTINGS,
} from '../app/lib/scan-core'

/** Settings come from three untrusted places: a database row, a PUT body typed
 *  by a person, and nothing at all. None may be able to stop the scanner. */
describe('normaliseSettings', () => {
  it('returns the documented defaults for empty input', () => {
    expect(normaliseSettings(undefined)).toEqual(DEFAULT_SCAN_SETTINGS)
    expect(normaliseSettings({})).toEqual(DEFAULT_SCAN_SETTINGS)
  })

  it('clamps out-of-range numbers instead of rejecting them', () => {
    const s = normaliseSettings({ lookback_days: 999, max_messages: 0, min_confidence: 4 })
    expect(s.lookback_days).toBe(30)
    expect(s.max_messages).toBe(1)
    expect(s.min_confidence).toBe(1)
  })

  it('accepts numeric strings, as arriving from a form', () => {
    const s = normaliseSettings({ lookback_days: '7', min_confidence: '0.85' })
    expect(s.lookback_days).toBe(7)
    expect(s.min_confidence).toBeCloseTo(0.85)
  })

  it('falls back rather than producing NaN from junk', () => {
    const s = normaliseSettings({ lookback_days: 'soon', max_messages: null })
    expect(s.lookback_days).toBe(3)
    expect(s.max_messages).toBe(25)
  })

  it('parses block lists from an array or a pasted string, and strips a leading @', () => {
    expect(normaliseSettings({ blocked_domains: '@spam.com, Foo.COM' }).blocked_domains)
      .toEqual(['spam.com', 'foo.com'])
    expect(normaliseSettings({ blocked_senders: ['A@B.com', ' ', 'c@d.com'] }).blocked_senders)
      .toEqual(['a@b.com', 'c@d.com'])
  })

  it('defaults schedule_enabled on, but honours an explicit false', () => {
    expect(normaliseSettings({}).schedule_enabled).toBe(true)
    expect(normaliseSettings({ schedule_enabled: false }).schedule_enabled).toBe(false)
  })
})

describe('gmailQuery', () => {
  it('builds the search from the lookback window', () => {
    expect(gmailQuery({ lookback_days: 3 })).toBe('in:inbox newer_than:3d')
    expect(gmailQuery({ lookback_days: 14 })).toBe('in:inbox newer_than:14d')
  })
})

describe('blockedReason', () => {
  const s = { blocked_domains: ['spam.com'], blocked_senders: ['bad@actor.com'] }

  it('blocks an exact sender', () => {
    expect(blockedReason('BAD@actor.com', s)).toMatch(/block list/)
  })

  it('blocks a domain and its subdomains', () => {
    expect(blockedReason('x@spam.com', s)).toMatch(/spam\.com/)
    expect(blockedReason('x@mail.spam.com', s)).toMatch(/spam\.com/)
  })

  it('does not block a domain that merely ends with the same letters', () => {
    expect(blockedReason('x@notspam.com', s)).toBeNull()
  })

  it('passes ordinary senders through', () => {
    expect(blockedReason('someone@realclient.com.au', s)).toBeNull()
    expect(blockedReason('', s)).toBeNull()
  })
})
