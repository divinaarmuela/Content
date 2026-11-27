import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * THE PREVIEW SHOWS THE WHOLE FEED (Karly, 27 Nov 2026: "on the preview section on the scheduler, can we see the
 * whole page? atm its a line and we have to scroll through"). It sat in a box that scrolled by itself — 654px tall
 * on a big monitor holding 2,569px of feed (measured on the live page), about one row on a laptop.
 */
describe('the Schedule’s Preview takes the height it needs', () => {
  const page = readFileSync('app/dashboard/social/schedule/page.tsx', 'utf8')

  it('the page grows for the Preview as it does for the Month, instead of holding one screen', () => {
    expect(page).toContain("const tallView = monthView || view === 'Preview'")
    expect(page).toContain("tallView ? 'min-h-[calc(100vh-var(--dbx-chrome,9rem))]' : 'h-[calc(100vh-var(--dbx-chrome,9rem))]'")
  })

  it('the Preview is not a box with its own scrollbar', () => {
    expect(page).toMatch(/view === 'Preview' \? \(\s+<div data-preview-whole>/)
  })

  it('the panel on the left stays in view while the feed scrolls', () => {
    expect(page).toContain("tallView && 'sticky top-0 h-[calc(100vh-var(--dbx-chrome,9rem))] self-start'")
  })
})
