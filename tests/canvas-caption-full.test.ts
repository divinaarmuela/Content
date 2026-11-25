import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { pictureFloorUnderCaption } from '../app/lib/batch-brief-core'

/**
 * THE WHOLE CAPTION SHOWS (Manal, 25 Nov 2026, a video of the StretchWorks board: "if I send this to the client
 * they're going to think that's where the caption ends … I can't physically extend my box so they can see the full
 * caption"). The caption under a picture stopped at 128px and scrolled inside itself — for the client too — and the
 * box it is typed in opened one line tall for a pasted paragraph.
 */
describe('a picture card shows its whole caption', () => {
  const card = readFileSync('app/dashboard/production/shoots/[id]/CanvasCard.tsx', 'utf8')
  const strip = /const captionStrip = [\s\S]{0,400}?<\/div>/.exec(card)?.[0] ?? ''
  it('the caption has no ceiling and no scroll of its own', () => {
    expect(strip).toContain('<CaptionField')
    expect(strip).not.toMatch(/max-h-|overflow-y-auto/)
  })
  it('the box it is typed in is as tall as its words, from the moment it is drawn', () => {
    const field = /function CaptionField[\s\S]*?\r?\n}\r?\n/.exec(card)?.[0] ?? ''
    expect(field).toMatch(/ref=\{fit\}/)
    expect(field).not.toMatch(/Math\.min\(t\.scrollHeight, 128\)/)
  })
  it('a picture somebody sized keeps the room it always had; a longer caption makes the card taller instead', () => {
    // the caption used to get 128px of the card's own height at most: the picture never had less than the rest
    expect(pictureFloorUnderCaption(400)).toBe(272)
    expect(pictureFloorUnderCaption(150)).toBe(90)
    expect(pictureFloorUnderCaption(undefined)).toBeUndefined()
  })
})
