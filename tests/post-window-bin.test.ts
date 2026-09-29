import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * THE BIN IN THE POST WINDOW ASKS WHERE IT CAN BE SEEN (the owner, 28 Sep 2026: "she was not able to click the bin
 * icon to delete the scheduled posts" — "any bin icon should be working"). The question "Take this post off the
 * calendar?" was drawn in the scrolling body, below the fold on a long post, so the press looked like nothing.
 */
describe('the post window bin', () => {
  // the one post window since the posting rebuild (29 Sep 2026): the bin is
  // `postActions`' danger button — Delete draft for a draft never sent,
  // Cancel post for anything else — and its question is drawn in the sticky
  // footer, right above the buttons, before the press goes to the act route
  const src = readFileSync('app/dashboard/social/schedule/PostWindow.tsx', 'utf8').replace(/\r\n/g, '\n')
  const footer = src.indexOf('<div className="sticky bottom-0 z-20 mt-auto flex flex-col gap-2 border-t border-border bg-popover p-3.5">')
  it('asks its question inside the sticky footer, above the buttons', () => {
    const question = src.indexOf('<QuestionPanel')
    const buttons = src.indexOf('data-footer-buttons')
    expect(footer).toBeGreaterThan(0)
    expect(question).toBeGreaterThan(footer)
    expect(question).toBeLessThan(buttons)
  })
  it('the bin is the danger button, and its press asks before it goes', () => {
    expect(src).toContain("kind === 'danger' && <Trash2")
    expect(src).toContain('onClick={() => press(offered)}')
    expect(src).toContain('const q = questionFor(offered)')
  })
})
