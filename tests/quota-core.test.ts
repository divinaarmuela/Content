import { describe, expect, it } from 'vitest'
import { postsLeft, quotaWords, readQuota } from '../app/lib/quota-core'

/**
 * THE DAY THE ACCOUNT HAS LEFT.
 *
 * The failure this guards against is the quiet one: a post booked for
 * tonight on an account that has already used its 24 hours, which the
 * network refuses hours later with nobody watching. The number is the
 * provider's own — Instagram's documented cap and its live cap disagree —
 * so nothing here may invent one.
 */
describe('reading the provider’s answer', () => {
  it('takes Instagram’s own numbers', () => {
    expect(readQuota({ quotaUsage: 3, quotaTotal: 50, quotaDurationSeconds: 86400 }))
      .toEqual({ used: 3, total: 50 })
  })

  it('reads the snake-cased spelling too', () => {
    expect(readQuota({ quota_usage: 12, quota_total: 100 })).toEqual({ used: 12, total: 100 })
  })

  it('no answer is NO ANSWER, never an empty day', () => {
    expect(readQuota(null)).toBeNull()
    expect(readQuota({})).toBeNull()
    expect(readQuota({ quotaUsage: 3 })).toBeNull()
    // a total of zero is not a limit anybody can act on
    expect(readQuota({ quotaUsage: 0, quotaTotal: 0 })).toBeNull()
  })

  it('never reports more used than the day holds', () => {
    expect(postsLeft({ used: 120, total: 100 })).toBe(0)
    expect(postsLeft({ used: 0, total: 100 })).toBe(100)
    expect(postsLeft(null)).toBeNull()
  })
})

describe('what the window says', () => {
  it('says how many are left, and does not block while there are any', () => {
    const said = quotaWords({ platform: 'instagram', handle: 'acme', quota: { used: 13, total: 100 } })
    expect(said.line).toBe('Instagram: 87 of 100 posts left today')
    expect(said.problem).toBeNull()
  })

  it('blocks with the network’s OWN total, not one of ours', () => {
    const said = quotaWords({ platform: 'instagram', handle: '@acme', quota: { used: 50, total: 50 } })
    expect(said.line).toBe('Instagram: 0 of 50 posts left today')
    expect(said.problem)
      .toBe('@acme has used today’s Instagram posting limit (50). Book it for tomorrow.')
  })

  it('names the time the window rolls when the provider gave one', () => {
    const said = quotaWords({
      platform: 'instagram', handle: 'acme',
      quota: { used: 100, total: 100 }, resetWords: '6:20 pm',
    })
    expect(said.problem)
      .toBe('@acme has used today’s Instagram posting limit (100). Book it for after 6:20 pm.')
  })

  it('TikTok answers yes or no, and a no blocks', () => {
    expect(quotaWords({ platform: 'tiktok', handle: 'acme', canPostMore: true }))
      .toEqual({ line: null, problem: null })
    const stop = quotaWords({ platform: 'tiktok', handle: 'acme', canPostMore: false })
    expect(stop.line).toBe('TikTok: no posts left today')
    expect(stop.problem).toBe('@acme has used today’s TikTok posting limit. Book it for tomorrow.')
  })

  it('says nothing at all when the provider said nothing', () => {
    expect(quotaWords({ platform: 'instagram', handle: 'acme' }))
      .toEqual({ line: null, problem: null })
    expect(quotaWords({ platform: 'linkedin', handle: 'acme', canPostMore: null }))
      .toEqual({ line: null, problem: null })
  })

  it('an account with no @name is still named as one', () => {
    expect(quotaWords({ platform: 'instagram', quota: { used: 100, total: 100 } }).problem)
      .toBe('This Instagram account has used today’s Instagram posting limit (100). Book it for tomorrow.')
  })
})
