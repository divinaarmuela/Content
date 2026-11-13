import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { groupAlign, groupColour, groupFont, groupOffers, groupTextColour, groupTextSize } from '../app/lib/canvas-group-core'
import type { CanvasCard } from '../app/lib/batch-brief-core'

const note = (id: string, extra: Partial<CanvasCard> = {}): CanvasCard => ({ id, kind: 'note', x: 0, y: 0, w: 208, z: 1, text: 'Words', color: 'yellow', ...extra } as CanvasCard)
const image = (id: string): CanvasCard => ({ id, kind: 'image', x: 0, y: 0, w: 300, z: 1, url: 'https://f/x.png' } as CanvasCard)
const label = (id: string): CanvasCard => ({ id, kind: 'label', x: 0, y: 0, w: 200, z: 1, text: 'Heading' } as CanvasCard)

describe('the toolbar on every picked card (the owner, 13 Nov 2026)', () => {
  const picked = [note('a'), note('b', { color: 'blue' as never }), image('i'), label('l')]
  it('a colour goes to the notes and to-dos, not to a picture or a heading, and only where it changes something', () => {
    const out = groupColour(picked, 'blue' as never)
    expect(out.map(c => c.id)).toEqual(['a'])
    expect(out[0].color).toBe('blue')
  })
  it('text size steps each card from its own size, and skips cards without words', () => {
    const out = groupTextSize([note('a', { size: 'sm' as never }), note('b', { size: 'xl' as never }), image('i')], 1)
    expect(out.map(c => c.id)).toEqual(['a']) // b is already the biggest, the picture has no words
    expect(out[0].size).not.toBe('sm')
    expect(out[0].w).toBeGreaterThanOrEqual(208)
  })
  it('text colour is put on all, and pressed again when all have it, taken off all', () => {
    const on = groupTextColour([note('a'), label('l'), image('i')], 'red' as never)
    expect(on.map(c => [c.id, c.text_color])).toEqual([['a', 'red'], ['l', 'red']])
    const off = groupTextColour(on, 'red' as never)
    expect(off.map(c => c.text_color)).toEqual([undefined, undefined])
  })
  it('alignment and font go to the cards with words; a card already there is not rewritten', () => {
    const once = groupAlign([note('a'), image('i')], 'right' as never)
    expect(once.map(c => [c.id, c.align])).toEqual([['a', 'right']])
    expect(groupAlign(once, 'right' as never)).toEqual([])
    const f = groupFont([note('a'), image('i')], 'serif' as never)
    expect(f.every(c => c.id !== 'i')).toBe(true)
  })
  it('says which groups a selection can use, so pictures alone get no colour or text tools', () => {
    expect(groupOffers([image('i'), image('j')])).toEqual({ colour: false, text: false, font: false })
    expect(groupOffers(picked).colour).toBe(true)
  })
  it('is on the board: one save for what changed, and Delete keeps back a board with cards inside', () => {
    const c = readFileSync('app/dashboard/production/shoots/[id]/BriefCanvas.tsx', 'utf8')
    expect(c).toContain('data-group-toolbar')
    expect(c).toContain('applyGroup(groupColour(pickedCards, c))')
    expect(c).toContain('applyGroup(groupTextSize(pickedCards, 1))')
    expect(c).toContain('const held = pickedCards.filter(c => deleteWarning(cards, c))')
    expect(c).toContain("label: 'Undo'")
  })
})
