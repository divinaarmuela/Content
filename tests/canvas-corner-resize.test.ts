import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { cornerPull, resizeCard } from '../app/lib/batch-brief-core'

/**
 * EVERY CARD RESIZES FROM ITS CORNER (the owner, 25 Nov 2026: "why is it so hard to resize links pasted or columns
 * from the corners"). Only the kinds with a height of their own had a corner handle; a column, a pasted post and a
 * heading had two small dots on their side edges and nothing where a hand goes first.
 */
describe('resizing from the corner', () => {
  it('a card with a height of its own takes the sideways pull as its width, as before', () => {
    expect(cornerPull('note', 40, 300)).toBe(40)
    expect(cornerPull('image', -25, 10)).toBe(-25)
  })
  it('a card that is only as wide as it is told — a column, a post, a heading — takes whichever way it is pulled further', () => {
    expect(cornerPull('column', 40, 10)).toBe(40)
    expect(cornerPull('column', 10, 60)).toBe(60)
    expect(cornerPull('mockup', -5, -80)).toBe(-80)
    expect(cornerPull('label', 30, -12)).toBe(30)
  })
  it('so pulling a column\'s corner down and out makes it wider', () => {
    expect(resizeCard('column', { w: 300, h: 500 }, cornerPull('column', 20, 90), 90).w).toBe(390)
  })
  it('the corner handle is on every kind of card, and held at the same size on screen whatever the zoom', () => {
    const canvas = readFileSync('app/dashboard/production/shoots/[id]/BriefCanvas.tsx', 'utf8')
    const handles = /RESIZE HANDLES[\s\S]*?THE CARD'S TOOLBAR/.exec(canvas)?.[0] ?? ''
    expect(handles).toContain('data-resize="se"')
    expect(handles).not.toMatch(/\{cardTakesHeight\(card\.kind\) && \(\s*<div role="presentation" aria-label="Resize"/)
    expect(handles).toMatch(/handleScale/)
    expect(canvas).toMatch(/cornerPull\(card\.kind, rawDx, dy\)/)
  })
})

/**
 * A DRAG ON THE BOARD IS NEVER THE BROWSER'S OWN DRAG (the owner, 25 Nov 2026: "why does the main toolbar get
 * highlighted" and "I can't drag the canvas, like it's stuck … I can't drag anything"). Reproduced with a real
 * mouse: the first drag panned 150px, every later one 15px — the browser sent `pointercancel` after the first move,
 * because the first drag had selected the toolbar's words and the next press was taken as dragging them.
 */
describe('dragging the board cannot be taken over by the browser', () => {
  const canvas = readFileSync('app/dashboard/production/shoots/[id]/BriefCanvas.tsx', 'utf8')
  it("the browser's own drag never starts on the board, except from a box being typed in", () => {
    expect(canvas).toMatch(/onDragStart=\{e => \{ if \(!\(e\.target as HTMLElement\)\.closest\?\.\('input, textarea, \[contenteditable="true"\]'\)\) e\.preventDefault\(\) \}\}/)
  })
  it('a press on the board lets go of words an earlier drag left selected, and selects none while it is held', () => {
    expect(canvas).toMatch(/if \(sel && !sel\.isCollapsed && !inBox\) sel\.removeAllRanges\(\)/)
    expect(canvas).toMatch(/document\.body\.style\.userSelect = 'none'/)
    expect(canvas).toMatch(/window\.addEventListener\('pointercancel', done, true\)/)
  })
})
