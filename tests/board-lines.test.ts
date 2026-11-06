import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  arrowHeadsOf, bendLine, controlThrough, lineMiddle, linePath, moveLineEnd, newFreeLine, straightenLine, withArrowHeads,
  type LineShape,
} from '../app/lib/board-canvas-core'

// LINES AS MILANOTE DRAWS THEM (the owner, 6 Nov 2026): start, end and a middle handle that bends the line.
// An imported Milanote line (sample values, no client data) and a card-to-card arrow (no line at all).
const MILANOTE: LineShape = { fx: 120, fy: 400, tx: 520, ty: 90, cx: 410, cy: 320, label: 'sample', start: 'none', end: 'arrow', dashed: true, weight: 4 }

describe('line geometry', () => {
  it('a bent line passes through its middle handle', () => {
    const a = { x: 0, y: 0 }, b = { x: 200, y: 0 }, mid = { x: 100, y: 80 }
    const c = controlThrough(a, b, mid)
    expect(c).toEqual({ x: 100, y: 160 })
    expect(lineMiddle(a, b, { cx: c.x, cy: c.y })).toEqual(mid)
  })
  it('straight and curved paths', () => {
    expect(linePath({ x: 1, y: 2 }, { x: 3, y: 4 })).toBe('M1,2 L3,4')
    expect(linePath({ x: 1, y: 2 }, { x: 3, y: 4 }, { cx: 9, cy: 9 })).toBe('M1,2 Q9,9 3,4')
  })
  it('a new free line is a diagonal with an arrowhead at its top end', () => {
    const l = newFreeLine({ x: 100, y: 100 })
    expect(l.end).toBe('arrow'); expect(l.start).toBe('none')
    expect(l.tx! > l.fx!).toBe(true); expect(l.ty! < l.fy!).toBe(true)
  })
})

describe('editing keeps everything the handle does not own', () => {
  it('bending an imported Milanote line changes only cx/cy', () => {
    const next = bendLine(MILANOTE, { x: 120, y: 400 }, { x: 520, y: 90 }, { x: 300, y: 200 })
    const { cx, cy, ...rest } = next
    const { cx: _a, cy: _b, ...before } = MILANOTE
    void _a; void _b
    expect(rest).toEqual(before)
    expect([cx, cy]).not.toEqual([MILANOTE.cx, MILANOTE.cy])
  })
  it('moving one end changes only that end', () => {
    const next = moveLineEnd(MILANOTE, 'end', { x: 700, y: 10 })
    expect(next).toEqual({ ...MILANOTE, tx: 700, ty: 10 })
    expect(moveLineEnd(MILANOTE, 'start', { x: 5, y: 6 })).toEqual({ ...MILANOTE, fx: 5, fy: 6 })
  })
  it('straightening removes only the curve', () => {
    const { cx: _a, cy: _b, ...rest } = MILANOTE
    void _a; void _b
    expect(straightenLine(MILANOTE)).toEqual(rest)
    expect(straightenLine(undefined)).toBeUndefined()
  })
  it('a card-to-card arrow (no line) keeps pointing when first bent or moved', () => {
    expect(bendLine(undefined, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 5 }).end).toBe('arrow')
    expect(moveLineEnd(undefined, 'end', { x: 1, y: 1 }).end).toBe('arrow')
    expect(arrowHeadsOf(undefined)).toBe('end')
  })
  it('arrowheads: end, start, both, none — round trip, other fields kept', () => {
    for (const h of ['end', 'start', 'both', 'none'] as const) {
      const next = withArrowHeads(MILANOTE, h)
      expect(arrowHeadsOf(next)).toBe(h)
      expect({ ...next, start: MILANOTE.start, end: MILANOTE.end }).toEqual(MILANOTE)
    }
  })
})

describe('the canvas writes a line only when somebody drags or changes it', () => {
  const src = readFileSync(join(__dirname, '..', 'app/dashboard/production/shoots/[id]/BriefCanvas.tsx'), 'utf8')
  it('an untouched line draws from what was saved', () => {
    expect(src).toContain('const arrow = lineEdit?.id === saved.id ? lineEdit.card : saved')
  })
  it('a press on a handle without a move saves nothing', () => {
    expect(src).toContain('if (before && JSON.stringify(before) === JSON.stringify(next)) return')
  })
  it('handles only for an editor, never on a view-only board', () => {
    expect(src).toContain('{isSel && !viewOnly && (() => {')
  })
  it('the toolbar has Line, and a card still joins another with "Line to…"', () => {
    expect(src).toMatch(/<MoveUpRight className="h-3\.5 w-3\.5" \/> Line\s*<\/Button>/)
    expect(src).toContain('Line to…')
  })
})

import { moveWholeLine as _moveWhole } from '../app/lib/board-canvas-core'
describe('moving a whole line (6 Nov 2026: "I can\'t position the arrow anywhere else")', () => {
  it('shifts both ends and the curve, keeping arrowheads and label', () => {
    const out = _moveWhole({ cx: 50, cy: 0, end: 'arrow', label: 'x', dashed: true }, { x: 0, y: 0 }, { x: 100, y: 0 }, 10, 20)
    expect(out).toEqual({ fx: 10, fy: 20, tx: 110, ty: 20, cx: 60, cy: 20, end: 'arrow', label: 'x', dashed: true })
  })
  it('a card-to-card arrow with no shape becomes a free line that still points', () => {
    expect(_moveWhole(undefined, { x: 5, y: 5 }, { x: 9, y: 9 }, 1, 1)).toEqual({ end: 'arrow', fx: 6, fy: 6, tx: 10, ty: 10 })
  })
})
