import { describe, it, expect } from 'vitest'
import { contentBox, keepInView } from '../app/lib/canvas-keep-in-view-core'

const vp = { w: 1000, h: 700 }
const box = contentBox([{ x: 0, y: 0, w: 400, h: 300 }, { x: 600, y: 100, w: 200, h: 100 }])!

describe('a board can never be pushed out of sight (4 Nov 2026)', () => {
  it('measures the content', () => {
    expect(box).toEqual({ x: 0, y: 0, w: 800, h: 300 })
  })
  it('leaves a camera that shows the content alone', () => {
    const cam = { x: 50, y: 50, s: 1 }
    expect(keepInView(cam, box, vp)).toBe(cam)
  })
  it('a wheel fling far left stops with the content still on screen', () => {
    const out = keepInView({ x: -5000, y: 0, s: 1 }, box, vp)
    expect(out.x + (box.x + box.w) * out.s).toBeGreaterThanOrEqual(160)
  })
  it('a fling far right / down stops too, at any zoom', () => {
    const out = keepInView({ x: 9000, y: 9000, s: 0.5 }, box, vp)
    expect(out.x + box.x * 0.5).toBeLessThanOrEqual(1000 - 160)
    expect(out.y + box.y * 0.5).toBeLessThanOrEqual(700 - 150)
  })
  it('an empty board pans freely', () => {
    const cam = { x: -9000, y: 0, s: 1 }
    expect(keepInView(cam, contentBox([]), vp)).toBe(cam)
  })
})
