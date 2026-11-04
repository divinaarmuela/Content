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

import { cardBoxes, keepAnyInView } from '../app/lib/canvas-keep-in-view-core'
describe('one stray card cannot stretch the board', () => {
  const boxes = cardBoxes([{ x: 0, y: 0, w: 300, h: 100 }, { x: -20000, y: -6647, w: 208, h: 52 }])
  it('a camera between the two (nothing on screen) is pulled back to the nearest card', () => {
    const out = keepAnyInView({ x: 3000, y: 1000, s: 1 }, boxes, vp)
    const seen = boxes.some(b => out.x + (b.x + b.w) * out.s >= 100 && out.x + b.x * out.s <= 900)
    expect(seen).toBe(true)
    expect(Math.abs(out.x)).toBeLessThan(5000)
  })
  it('a camera already showing a card is left alone', () => {
    const cam = { x: 100, y: 100, s: 1 }
    expect(keepAnyInView(cam, boxes, vp)).toBe(cam)
  })
})

describe('arrows do not count as something on screen', () => {
  it('an arrow alone in view is not enough', () => {
    expect(cardBoxes([{ x: 0, y: 0, w: 3000, h: 10, kind: 'arrow' }, { x: 0, y: 0, w: 100, h: 100, kind: 'note' }])).toEqual([{ x: 0, y: 0, w: 100, h: 100 }])
  })
})
