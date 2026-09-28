import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * A DISCONNECT LOSES NOTHING (the owner, 28 Sep 2026: "why is the data lost when an account is disconnected" —
 * Jordan Wilson's Instagram was cut off by Meta and his People page went blank). Posting needs the connection;
 * reading followers and likers does not, so a disconnected account is still read, and its history still shown.
 */
describe('a disconnected Instagram keeps its data', () => {
  it('the People page, the morning follower look and the likes read do not skip it', () => {
    for (const f of ['app/lib/people-analytics.ts', 'app/lib/followers.ts', 'app/lib/post-interactors.ts']) {
      const src = readFileSync(f, 'utf8')
      expect(src, f).not.toContain("a.active !== false")
      expect(src, f).toContain('A DISCONNECT LOSES NOTHING')
    }
    expect(readFileSync('app/lib/followers.ts', 'utf8')).not.toContain("if (account.active === false) return { ok: false, reason: 'inactive' }")
  })
})
