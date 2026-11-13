import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * META'S REVIEWER NEVER SEES THE SIDEBAR, NOT EVEN WHILE SIGNING OUT (the owner, 13 Nov 2026). Clerk's user goes
 * empty a moment before the page leaves; the reviewer check must not flip back to "show everything" in that moment.
 */
describe('Shell: the reviewer lock holds through sign-out', () => {
  const src = readFileSync('app/dashboard/ui/Shell.tsx', 'utf8')
  it('remembers the reviewer for the life of the page', () => {
    expect(src).toContain('const reviewerSeen = useRef(false)')
    expect(src).toContain('if (isReviewer(useUser().user?.id)) reviewerSeen.current = true')
    expect(src).toContain('const reviewer = reviewerSeen.current')
  })
  it('no longer reads the lock straight off the live user', () => {
    expect(src).not.toContain('const reviewer = isReviewer(useUser().user?.id)')
  })
})
