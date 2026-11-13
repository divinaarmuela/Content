import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { ALIGN_REACH_PX, alignTo } from '../app/lib/canvas-align-core'

const other = { x: 100, y: 100, w: 200, h: 80 }

describe('cards line up with each other as you drag (Divina, 13 Nov 2026)', () => {
  it('pulls a left edge onto another card\'s left edge, and shows where', () => {
    const a = alignTo({ x: 103, y: 400, w: 200, h: 80 }, [other], 6)
    expect(a).toMatchObject({ x: 100, guideX: 100, y: 400, guideY: null })
  })
  it('lines up centres and right edges too, and tops, middles and bottoms', () => {
    // a narrower card whose centre is 2 off the other's centre (200)
    expect(alignTo({ x: 152, y: 400, w: 100, h: 80 }, [other], 6)).toMatchObject({ x: 150, guideX: 200 })
    // right edges: 300
    expect(alignTo({ x: 212, y: 400, w: 90, h: 80 }, [other], 6)).toMatchObject({ x: 210, guideX: 300 })
    // tops
    expect(alignTo({ x: 600, y: 96, w: 100, h: 40 }, [other], 6)).toMatchObject({ y: 100, guideY: 100, guideX: null })
    // bottoms: 180
    expect(alignTo({ x: 600, y: 152, w: 100, h: 30 }, [other], 6)).toMatchObject({ y: 150, guideY: 180 })
  })
  it('each direction is decided on its own, against whichever card is nearest', () => {
    const a = alignTo({ x: 103, y: 503, w: 200, h: 80 }, [other, { x: 700, y: 500, w: 50, h: 50 }], 6)
    expect(a).toMatchObject({ x: 100, y: 500, guideX: 100, guideY: 500 })
  })
  it('leaves a card alone when nothing is within reach, and takes the nearest of two', () => {
    expect(alignTo({ x: 120, y: 400, w: 200, h: 80 }, [other], 6)).toMatchObject({ x: 120, guideX: null })
    expect(alignTo({ x: 104, y: 400, w: 200, h: 80 }, [other, { x: 105, y: 900, w: 10, h: 10 }], 6)).toMatchObject({ x: 105 })
    expect(alignTo({ x: 5, y: 5, w: 10, h: 10 }, [], 6)).toEqual({ x: 5, y: 5, guideX: null, guideY: null })
  })
  it('is wired into the board: the pull scales with zoom, Alt places freely, and a met line is not moved onto the grid', () => {
    expect(ALIGN_REACH_PX).toBe(6)
    const c = readFileSync('app/dashboard/production/shoots/[id]/BriefCanvas.tsx', 'utf8')
    expect(c).toContain('alignTo({ x: d.nx, y: d.ny, w: d.half.w * 2, h: d.half.h * 2 }, d.still, ALIGN_REACH_PX / s)')
    expect(c).toContain('if (!d.host && d.still?.length && !e.altKey)')
    expect(c).toContain('(d.ax ? Math.round(d.nx) : snap(d.ox + (e.clientX - d.startX) / s)) - card.x')
    expect(c.match(/clearGuides\(d\)/g)!.length).toBeGreaterThanOrEqual(2)
  })
})

describe('a copied picture pastes onto the board (the owner, 13 Nov 2026)', () => {
  it('the board reads pictures off the clipboard before it looks for a table, and never while typing in a note', () => {
    const c = readFileSync('app/dashboard/production/shoots/[id]/BriefCanvas.tsx', 'utf8')
    const paste = c.slice(c.indexOf('const onPaste = (e: ClipboardEvent) => {'), c.indexOf("window.addEventListener('paste', onPaste)"))
    expect(paste).toContain("t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable")
    expect(paste.indexOf("i.type.startsWith('image/')")).toBeGreaterThan(-1)
    expect(paste.indexOf("i.type.startsWith('image/')")).toBeLessThan(paste.indexOf('tableFromClipboard('))
    expect(paste).toContain('void addImagesRef.current(pictures)')
  })
})
