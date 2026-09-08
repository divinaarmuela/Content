import { describe, expect, it } from 'vitest'
import {
  accountsNeedingWord, healthVerdict, needsReconnect, readStoredHealth, reconnectSubject,
} from '../app/lib/account-health-core'

/* ── is this account still connected? (9 Sep 2026) ─────────────────────── */

const NOW = Date.parse('2026-09-09T02:00:00Z')
const day = (n: number) => new Date(NOW + n * 86_400_000).toISOString()

describe('healthVerdict — the provider\'s row in three words', () => {
  it('healthy, a long way from expiry: ok', () => {
    const h = healthVerdict({ status: 'healthy', tokenValid: true, tokenExpiresAt: day(45), needsReconnect: false, canPost: true, issues: [] }, NOW)
    expect(h.level).toBe('ok')
    expect(h.reason).toBe('Connected')
    expect(h.can_post).toBe(true)
  })
  it('the provider says reconnect, or the token is dead, or posting is off: act', () => {
    expect(healthVerdict({ status: 'healthy', tokenValid: true, needsReconnect: true }, NOW).level).toBe('act')
    expect(healthVerdict({ status: 'error', tokenValid: false, issues: ['Token revoked by the user'] }, NOW)).toMatchObject({ level: 'act', reason: 'Token revoked by the user', can_post: false })
    expect(healthVerdict({ status: 'healthy', tokenValid: true, canPost: false }, NOW).level).toBe('act')
  })
  it('a token past its date is act, even if the provider still says healthy', () => {
    expect(healthVerdict({ status: 'healthy', tokenValid: true, tokenExpiresAt: day(-1) }, NOW).level).toBe('act')
  })
  it('a token that runs out within a week is watch, with the days in the sentence', () => {
    const h = healthVerdict({ status: 'healthy', tokenValid: true, tokenExpiresAt: day(3) }, NOW)
    expect(h.level).toBe('watch')
    expect(h.reason).toMatch(/runs out in 3 days/)
    expect(healthVerdict({ status: 'warning', tokenValid: true, tokenExpiresAt: day(40), issues: ['Missing permission: pages_read'] }, NOW)).toMatchObject({ level: 'watch', reason: 'Missing permission: pages_read' })
  })
  it('the live shape read on 9 Sep 2026 parses', () => {
    const live = { accountId: '6a94d22f77555aae01271b2c', platform: 'tiktok', username: 'yusufuryurr', status: 'healthy', canPost: true, tokenValid: true, tokenExpiresAt: '2026-09-09T08:47:20.491Z', needsReconnect: false, issues: [] }
    const h = healthVerdict(live, NOW)
    // six hours left: watch, one day
    expect(h.level).toBe('watch')
    expect(h.expires_at).toBe('2026-09-09T08:47:20.491Z')
  })
})

describe('the stored row, and the words', () => {
  it('reads back, and refuses rubbish', () => {
    expect(readStoredHealth({ level: 'act', reason: 'x', can_post: false, expires_at: null, checked_at: 't' })?.level).toBe('act')
    expect(readStoredHealth({ level: 'bad' })).toBeNull()
    expect(readStoredHealth(null)).toBeNull()
  })
  it('Reconnect belongs only on act', () => {
    expect(needsReconnect({ level: 'act', reason: '', can_post: false, expires_at: null, checked_at: '' })).toBe(true)
    expect(needsReconnect({ level: 'watch', reason: '', can_post: true, expires_at: null, checked_at: '' })).toBe(false)
    expect(needsReconnect(null)).toBe(false)
  })
  it('names the account and the client in the subject', () => {
    expect(reconnectSubject({ username: 'yusufuryurr', platform: 'tiktok' }, '100 Hundred Million Group')).toBe('Reconnect yusufuryurr (tiktok) — 100 Hundred Million Group')
    expect(reconnectSubject({ username: null, name: null, platform: 'instagram' }, null)).toBe('Reconnect instagram (instagram)')
  })
  it('sorts the accounts that need a word', () => {
    const rows = [
      { id: 'a', health: { level: 'act' as const, reason: '', can_post: false, expires_at: null, checked_at: '' } },
      { id: 'b', health: { level: 'ok' as const, reason: '', can_post: true, expires_at: null, checked_at: '' } },
      { id: 'c', health: { level: 'watch' as const, reason: '', can_post: true, expires_at: null, checked_at: '' } },
      { id: 'd', health: null },
    ]
    const w = accountsNeedingWord(rows)
    expect(w.act.map(r => r.id)).toEqual(['a'])
    expect(w.watch.map(r => r.id)).toEqual(['c'])
  })
})
