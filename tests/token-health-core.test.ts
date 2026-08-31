import { describe, it, expect } from 'vitest'
import {
  daysUntil, needsAttention, saysAutoRenews, timeLeftWords, tokenNotice,
  type TokenStatus,
} from '../app/lib/token-health-core'

const NOW = Date.parse('2026-08-31T12:00:00Z')
const inDays = (n: number) => new Date(NOW + n * 86400000).toISOString()

/** A TikTok or YouTube account connected minutes ago: the access token dies
 *  tomorrow, the provider says it renews itself, and nothing is wrong. */
const freshlyConnected: TokenStatus = {
  valid: true,
  expiresAt: inDays(1),
  expiresIn: 'Auto-refreshes',
  needsRefresh: false,
}

describe('an account that renews itself is not an account in trouble', () => {
  // the bug: `needsRefresh || days <= 14` fired on a one-day token from the
  // moment it was connected, and kept firing, on a perfectly healthy account
  it('says there is nothing to do', () => {
    const notice = tokenNotice(freshlyConnected, NOW)!
    expect(notice.level).toBe('ok')
    expect(notice.autoRenews).toBe(true)
    expect(notice.advice).toMatch(/nothing to do/i)
  })

  it('never asks for a reconnect it cannot offer', () => {
    expect(tokenNotice(freshlyConnected, NOW)!.needsReconnect).toBe(false)
  })

  it('keeps it out of the list of channels needing a person', () => {
    const rows = [{ row: 'tiktok', status: freshlyConnected }]
    expect(needsAttention(rows, NOW)).toEqual([])
  })

  it('believes a short window the provider calls healthy, however it is worded', () => {
    // the same account without the "Auto-refreshes" text: a provider that
    // reports valid and no refresh needed on a one-day token is describing a
    // refresh token, whatever words it used
    const quiet = { ...freshlyConnected, expiresIn: null }
    expect(tokenNotice(quiet, NOW)!.level).toBe('ok')
    expect(tokenNotice(quiet, NOW)!.autoRenews).toBe(true)
  })
})

describe('an account that really does need a person', () => {
  it('acts on a token the provider calls invalid', () => {
    const notice = tokenNotice({ valid: false, expiresAt: inDays(-1) }, NOW)!
    expect(notice.level).toBe('act')
    expect(notice.needsReconnect).toBe(true)
    expect(notice.advice).toMatch(/disconnected/i)
  })

  it('acts when the provider says it can no longer renew it', () => {
    const notice = tokenNotice(
      { valid: true, expiresAt: inDays(3), needsRefresh: true }, NOW)!
    expect(notice.level).toBe('act')
    expect(notice.needsReconnect).toBe(true)
  })

  it('watches a long-lived token that will not renew — the Meta page case', () => {
    // 60 days out and healthy: nothing to say
    const far = tokenNotice({ valid: true, expiresAt: inDays(60), expiresIn: 'in 60 days' }, NOW)!
    expect(far.level).toBe('ok')
    expect(far.needsReconnect).toBe(false)

    // ten days out and still no sign it renews: this is the real warning
    const near = tokenNotice({ valid: true, expiresAt: inDays(10), expiresIn: 'in 10 days' }, NOW)!
    expect(near.level).toBe('watch')
    expect(near.needsReconnect).toBe(true)
    expect(near.advice).toMatch(/does not renew/i)
  })

  it('sorts the ones that are already broken above the ones that will be', () => {
    const rows = [
      { row: 'watch-me', status: { valid: true, expiresAt: inDays(10), expiresIn: 'in 10 days' } },
      { row: 'broken', status: { valid: false, expiresAt: inDays(-2) } },
      { row: 'fine', status: freshlyConnected },
    ]
    expect(needsAttention(rows, NOW).map(r => r.row)).toEqual(['broken', 'watch-me'])
  })
})

describe('the words and the button always agree', () => {
  // the failure this replaces: "Use Reconnect account above" printed under a
  // page that had decided not to render the button
  const cases: TokenStatus[] = [
    freshlyConnected,
    { valid: false, expiresAt: inDays(-1) },
    { valid: true, expiresAt: inDays(3), needsRefresh: true },
    { valid: true, expiresAt: inDays(10), expiresIn: 'in 10 days' },
    { valid: true, expiresAt: inDays(60), expiresIn: 'in 60 days' },
  ]

  it('only mentions reconnecting when a reconnect is offered', () => {
    for (const status of cases) {
      const notice = tokenNotice(status, NOW)
      if (!notice) continue
      const mentions = /reconnect/i.test(notice.advice)
      expect(mentions, `advice and button disagree: ${notice.advice}`)
        .toBe(notice.needsReconnect)
    }
  })

  it('never threatens silent failure on an account that is fine', () => {
    const notice = tokenNotice(freshlyConnected, NOW)!
    expect(notice.advice).not.toMatch(/will not go out|fail/i)
  })
})

describe('missing information is not an alarm', () => {
  it('says nothing at all without a token status', () => {
    expect(tokenNotice(null, NOW)).toBeNull()
    expect(tokenNotice(undefined, NOW)).toBeNull()
  })

  it('says nothing when there is no date and no complaint', () => {
    expect(tokenNotice({ valid: true }, NOW)).toBeNull()
  })

  it('ignores a date it cannot read rather than treating it as expired', () => {
    expect(daysUntil('not a date', NOW)).toBeNull()
    expect(daysUntil(null, NOW)).toBeNull()
    expect(tokenNotice({ valid: true, expiresAt: 'not a date' }, NOW)).toBeNull()
  })
})

describe('reading the provider at its word', () => {
  it('recognises the ways it says a token renews itself', () => {
    expect(saysAutoRenews('Auto-refreshes')).toBe(true)
    expect(saysAutoRenews('auto refresh')).toBe(true)
    expect(saysAutoRenews('renews automatically')).toBe(true)
    expect(saysAutoRenews('in 58 days')).toBe(false)
    expect(saysAutoRenews(null)).toBe(false)
  })

  it('counts the days the way a person would say them', () => {
    expect(timeLeftWords(1)).toBe('1 day left')
    expect(timeLeftWords(12)).toBe('12 days left')
    expect(timeLeftWords(0)).toBe('expired')
    expect(timeLeftWords(-3)).toBe('expired')
    expect(timeLeftWords(null)).toBe('no expiry date given')
  })
})
