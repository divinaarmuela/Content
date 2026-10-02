import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

/* ── the Scheduling tab (docs/ONE_PORTAL_SPEC.md R10, R11) ── */

vi.mock('@/lib/db', () => ({ table: () => ({ get: async () => null, list: async () => [], claim: async () => ({ claimed: false }) }) }))
const { schedulingWaiting } = await import('../app/lib/one-portal-schedule')

const t = (over: Record<string, unknown>) => ({ post_id: 'p', state: 'not_reviewed', answerable: true, ...over }) as never
const profile = (booked: unknown[], off: unknown[] = []) => ({ network: 'instagram', booked, off, posted: [] }) as never

describe('the Scheduling badge', () => {
  it('counts a booked post the client has not answered, once across networks', () => {
    expect(schedulingWaiting([profile([t({ post_id: 'a' })]), profile([t({ post_id: 'a' })])])).toBe(1)
    expect(schedulingWaiting([profile([t({ post_id: 'a', state: 'approved' })])])).toBe(0)
    expect(schedulingWaiting([profile([t({ post_id: 'a', state: 'asked_again' })])])).toBe(1)
  })
  it('counts a "wait" post that came off unanswered; never one they said no to', () => {
    expect(schedulingWaiting([profile([], [t({ post_id: 'w', answerable: true })])])).toBe(1)
    expect(schedulingWaiting([profile([], [t({ post_id: 'n', state: 'not_approved', answerable: false })])])).toBe(0)
  })
})

describe('the tab', () => {
  const loader = readFileSync('app/lib/one-portal-schedule.ts', 'utf8')
  const ui = readFileSync('app/components/portal/OnePortalScheduling.tsx', 'utf8')
  it('reads the feeds from the stored copy, refreshed every 15 minutes, never on every visit', () => {
    expect(loader).toContain('const FEED_FRESH_MS = 15 * 60 * 1000')
    expect(loader).toMatch(/if \(fresh\) return/)
    expect(loader).toMatch(/withFeeds \? await feedFor\(account, now\)/)
  })
  it('keeps a person to their own posts', () => {
    expect(loader).toMatch(/postOnPortal\(contactOf\(p\), scope\)/)
  })
  it('the client answers the frozen version they saw, with their name, and a note for Not approved', () => {
    expect(ui).toContain("body: JSON.stringify({ token, post_id: tile.post_id, version: tile.version, action, note: note.trim() || null, author_name: name.trim() })")
    expect(ui).toContain("if (!name.trim()) { toast.error('Add your name so the team knows who answered.'); return }")
    expect(ui).toContain("if (action === 'client_not_approved' && !note.trim())")
  })
  it('each network as its own profile: Instagram a grid, LinkedIn a feed, TikTok a 9:16 grid', () => {
    expect(ui).toContain("profile.network === 'linkedin'")
    expect(ui).toContain("tall={profile.network === 'tiktok'}")
    expect(ui).toContain("const aspect = tall ? 'aspect-[9/16]' : 'aspect-[4/5]'")
  })
})
