import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { COLUMN_TITLE_PX, hasTextSize, hasTextStyle, sanitiseCanvasCards } from '../app/lib/batch-brief-core'
import { groupTextSize } from '../app/lib/canvas-group-core'

/**
 * A COLUMN'S TITLE CAN CHANGE SIZE (the owner, 25 Nov 2026: "when clicking a column it doesn't allow me to change
 * the text size"). A column had the typeface choice but no A− / A+, and a size sent for one was thrown away on save.
 */
describe("a column's title has a text size", () => {
  const column = { id: 'c', kind: 'column', x: 0, y: 0, w: 300, z: 1, name: 'Day 1' }
  it('a column takes a text size, like a note, a heading, a to-do and a board', () => {
    for (const k of ['note', 'label', 'todo', 'board', 'column']) expect(hasTextSize(k)).toBe(true)
    for (const k of ['image', 'link', 'mockup', 'arrow', 'table', undefined]) expect(hasTextSize(k)).toBe(false)
  })
  it('it still has no text colour or alignment of its own — those stay with the kinds that had them', () => {
    expect(hasTextStyle('column')).toBe(false)
  })
  it('the size survives a save', () => {
    expect(sanitiseCanvasCards([{ ...column, size: 'xl' }])[0].size).toBe('xl')
    expect(sanitiseCanvasCards([{ ...column, size: 'huge' }])[0].size).toBeUndefined()
  })
  it('Normal is the size a column title has always been, so no existing column changes', () => {
    expect(COLUMN_TITLE_PX.md).toBe(17)
    expect(COLUMN_TITLE_PX.sm).toBeLessThan(COLUMN_TITLE_PX.md)
    expect(COLUMN_TITLE_PX.xl).toBeGreaterThan(COLUMN_TITLE_PX.lg)
  })
  it('a column picked with other cards steps with them', () => {
    const out = groupTextSize(sanitiseCanvasCards([column, { id: 'n', kind: 'note', x: 0, y: 0, w: 200, z: 1, text: 'hi' }]), 1)
    expect(out.find(c => c.id === 'c')?.size).toBe('lg')
  })
  it('the toolbar offers A− / A+ on a column, and the title is drawn at that size', () => {
    const canvas = readFileSync('app/dashboard/production/shoots/[id]/BriefCanvas.tsx', 'utf8')
    expect(canvas).toMatch(/\{hasTextSize\(card\.kind\) && \(/)
    const cards = readFileSync('app/dashboard/production/shoots/[id]/MilanoteCards.tsx', 'utf8')
    expect(cards).toMatch(/COLUMN_TITLE_PX\[textSizeOf\(card\)\]/)
  })
})
