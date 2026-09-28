import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * THE MORNING LOOK (28 Sep 2026: Divina asked how Jordan's and Justin's conversions are tracked; no client had a
 * follower look on 26 or 27 Sep, and Jordan Wilson's first post sat "running" with no likes or comments read).
 */
describe('the followers morning job', () => {
  const src = readFileSync('app/inngest/functions.ts', 'utf8')
  const body = src.slice(src.indexOf("id: 'followers-daily'"), src.indexOf("id: 'followers-snapshot'"))

  it('sends the follower looks before any slow read', () => {
    expect(body.indexOf("'dispatch-looks'")).toBeGreaterThan(0)
    expect(body.indexOf("'dispatch-looks'")).toBeLessThan(body.indexOf('read-post-'))
  })

  it('reads each post in its own step — one hang costs one post', () => {
    expect(body).toContain('step.run(`read-post-${id}`')
    expect(body).not.toContain('readDueInteractors(')
  })

  it('a read killed mid-flight is taken over after 15 minutes', () => {
    const lib = readFileSync('app/lib/post-interactors.ts', 'utf8')
    expect(lib).toContain('15 * 60_000')
    expect(lib).toContain("status: 'running', fetched_day: today, fetched_at: stamp")
  })
})
