/**
 * A BOARD CAN NEVER BE PUSHED OUT OF SIGHT (the owner, 4 Nov 2026, a video
 * of a Mac with an external screen: the notes slide away under the cursor
 * until the board is empty, "on some devices", on both Boards and the shoot
 * brief).
 *
 * Why only some devices: both canvases pan on the scroll wheel. A Magic Mouse
 * or a trackpad sends scroll for the lightest brush of a finger, and macOS
 * keeps sending it (momentum) after the finger lifts, so the board glides off
 * on its own. Boards also remembered that view, so it reopened empty.
 *
 * The rule: some of the content always stays on screen. Pan as far as you
 * like; the last `margin` px of the nearest card stops at the edge.
 *
 * Pure: a camera is `x, y` (screen px of the world origin) and `s` (scale).
 */

export type Box = { x: number; y: number; w: number; h: number }
export type Cam = { x: number; y: number; s: number }

/** the world box around every card, or null when there are none */
export function contentBox(cards: readonly { x: number; y: number; w?: number | null; h?: number | null }[]): Box | null {
  if (cards.length === 0) return null
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const c of cards) {
    if (!Number.isFinite(c.x) || !Number.isFinite(c.y)) continue
    const w = Number.isFinite(c.w as number) && (c.w as number) > 0 ? (c.w as number) : 200
    const h = Number.isFinite(c.h as number) && (c.h as number) > 0 ? (c.h as number) : 120
    x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y)
    x1 = Math.max(x1, c.x + w); y1 = Math.max(y1, c.y + h)
  }
  if (!Number.isFinite(x0)) return null
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)))

/** The same camera, moved back just enough that `margin` px of the content is in the viewport. */
export function keepInView(cam: Cam, box: Box | null, viewport: { w: number; h: number }, margin = 160): Cam {
  if (!box || viewport.w <= 0 || viewport.h <= 0) return cam
  const mx = Math.min(margin, box.w * cam.s, viewport.w / 2)
  const my = Math.min(margin, box.h * cam.s, viewport.h / 2)
  // right edge of the content at least mx from the left; left edge at most vw - mx
  const x = clamp(cam.x, mx - (box.x + box.w) * cam.s, viewport.w - mx - box.x * cam.s)
  const y = clamp(cam.y, my - (box.y + box.h) * cam.s, viewport.h - my - box.y * cam.s)
  return x === cam.x && y === cam.y ? cam : { ...cam, x, y }
}
