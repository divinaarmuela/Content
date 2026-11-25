import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { pictureFloorUnderCaption, pictureRoomUnderCaption } from '../app/lib/batch-brief-core'

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
  /* Renee, 25 Nov 2026 (the Alia shoot brief): "i refreshed page and the photos glitched and moved, tried to resize but
   * it bounces back". A card that grows is `min-height`, so `flex: 1 1 0%` on its picture meant the picture's own
   * height: measured in Chrome, a 236 x 381 card holding a phone screenshot drew 561px tall, and 381 again with a
   * pixel basis. The picture's room is its floor AND its basis, on the picture and on the clip alike. */
  it('a sized picture starts at its floor, not at its own height — the card stays the size it was given', () => {
    expect(pictureRoomUnderCaption(381)).toEqual({ minHeight: 253, flexBasis: 253 })
    expect(pictureRoomUnderCaption(undefined)).toBeUndefined()
    expect(card.match(/style=\{captionStrip \? pictureRoomUnderCaption\(card\.h\) : undefined\}/g)).toHaveLength(2)
    expect(card).not.toMatch(/minHeight: pictureFloorUnderCaption\(card\.h\)/)
  })
})
