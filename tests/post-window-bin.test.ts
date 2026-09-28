import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * THE BIN IN THE POST WINDOW ASKS WHERE IT CAN BE SEEN (the owner, 28 Sep 2026: "she was not able to click the bin
 * icon to delete the scheduled posts" — "any bin icon should be working"). The question "Take this post off the
 * calendar?" was drawn in the scrolling body, below the fold on a long post, so the press looked like nothing.
 */
describe('the post window bin', () => {
  const src = readFileSync('app/dashboard/social/schedule/NewPostDialog.tsx', 'utf8')
  const footer = src.indexOf('<div className="sticky bottom-0 z-20 mt-auto flex flex-wrap items-center gap-3 border-t border-border bg-surface p-3.5">')
  it('asks its question inside the sticky footer, beside the bin', () => {
    const question = src.indexOf("'Take this post off the calendar? The piece itself is not deleted.'")
    const bin = src.indexOf("aria-label={state.postId ? 'Take this post off the calendar' : 'Close without saving'}")
    expect(footer).toBeGreaterThan(0)
    expect(question).toBeGreaterThan(footer)
    expect(question).toBeLessThan(bin)
  })
  it('the bin press opens the question; Take it off calls the delete', () => {
    expect(src).toContain("onClick={() => (state.postId ? setConfirm('delete') : requestClose())}")
    expect(src).toContain("onClick={() => (confirm === 'close' ? onClose() : void remove())}")
    expect(src).toContain("fetch(`/api/social/schedule/${state.postId}`, { method: 'DELETE' })")
  })
})
