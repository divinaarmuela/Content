import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

/* ── profile pictures (5 Oct 2026: "profile pic for insta is broken… on the client portal") ── */

vi.mock('@/lib/db', () => ({ table: () => ({ list: async () => [], update: async () => null }) }))
vi.mock('../app/lib/publisher', () => ({ getPublisher: () => ({ listAccounts: async () => [] }) }))
const { avatarStale } = await import('../app/lib/account-avatars')

describe('a stored picture link is stale when it is missing or its signature has run out', () => {
  const now = Date.parse('2026-10-05T06:00:00Z')
  const signed = (iso: string) => `https://scontent.cdninstagram.com/v/pic.jpg?oe=${Math.floor(Date.parse(iso) / 1000).toString(16).toUpperCase()}`
  it('Instagram\'s `oe=` is hex seconds: past it, or within the hour, is stale', () => {
    expect(avatarStale(signed('2026-10-04T13:37:00Z'), now)).toBe(true)
    expect(avatarStale(signed('2026-10-05T06:30:00Z'), now)).toBe(true)
    expect(avatarStale(signed('2026-10-08T15:00:00Z'), now)).toBe(false)
  })
  it('no picture at all is stale; a link with no signature never is', () => {
    expect(avatarStale(null, now)).toBe(true)
    expect(avatarStale('https://media.licdn.com/pic.jpg', now)).toBe(false)
  })
})

describe('where the pictures are read again', () => {
  it('every morning with the health check, and on the portal the moment it meets a stale one — bounded, and only with the feeds', () => {
    expect(readFileSync('app/lib/account-health.ts', 'utf8')).toContain('await refreshAvatars().catch(() => undefined)')
    const portal = readFileSync('app/lib/one-portal-schedule.ts', 'utf8')
    expect(portal).toContain('if (withFeeds && accounts.some(a => avatarStale(a.avatar_url, now.getTime()))) {')
    expect(portal).toContain('setTimeout(() => resolve(new Map()), 4000)')
  })
})
