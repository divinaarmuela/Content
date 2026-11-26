import { describe, expect, it } from 'vitest'
import { boardThumb, thumbPlan, THUMB_WIDTHS } from '../app/lib/board-thumb-core'

/**
 * SMALL COPIES OF BOARD PICTURES (the owner, 26 Nov 2026: a board "lags heavily when going around the canvas" while
 * pictures load — measured on the Alia brief: 77 pictures, 161 megapixels decoded to draw 0.4). A board draws a
 * small copy; the full-size file is for opening a card and for print.
 */
const BASE = 'https://pub-abc123.r2.dev'
const FILE = `${BASE}/1795398310833-3whpyv-photo.png`

describe('which address a board draws a picture from', () => {
  it('our own stored pictures go through the small-copy route', () => {
    expect(boardThumb(FILE)).toBe(`/api/img?u=${encodeURIComponent(FILE)}&w=640`)
    expect(boardThumb(FILE, 900)).toBe(`/api/img?u=${encodeURIComponent(FILE)}&w=1280`)
    expect(boardThumb(FILE, 200)).toBe(`/api/img?u=${encodeURIComponent(FILE)}&w=640`)
  })
  it('anything else is drawn from where it lives: another site, a blob, a data picture, a GIF, an SVG, nothing', () => {
    for (const url of ['https://i.pinimg.com/736x/a.jpg', 'blob:https://app/x', 'data:image/png;base64,AAAA', `${BASE}/moving.gif`, `${BASE}/logo.svg`, `${BASE}/clip.mp4`, 'not a url', '']) {
      expect(boardThumb(url), url).toBe(url)
    }
    expect(boardThumb(null)).toBe('')
    expect(boardThumb(undefined)).toBe('')
  })
  it('a small copy is never asked to make a small copy of itself', () => {
    expect(boardThumb(`${BASE}/thumb/w640/abc.webp`)).toBe(`${BASE}/thumb/w640/abc.webp`)
  })
})

describe('what the small-copy route agrees to make', () => {
  it('a copy of a picture in our own storage, at one of the fixed widths, kept under a name worked out from the picture', () => {
    const plan = thumbPlan(FILE, '640', BASE)
    expect(plan).toMatchObject({ ok: true, width: 640, source: FILE })
    expect(plan.ok && plan.key).toMatch(/^thumb\/w640\/[0-9a-f]{40}\.webp$/)
    // the same picture and width are always the same name; another width is another
    expect(thumbPlan(FILE, '640', `${BASE}/`)).toEqual(plan)
    const big = thumbPlan(FILE, '1280', BASE)
    expect(big.ok && plan.ok && big.key !== plan.key).toBe(true)
  })
  it('a width that is not one of ours becomes the standard one — nobody can ask for ten thousand sizes', () => {
    expect(THUMB_WIDTHS).toEqual([640, 1280])
    for (const w of ['999', '0', '-5', 'abc', '', null]) expect(thumbPlan(FILE, w, BASE)).toMatchObject({ ok: true, width: 640 })
  })
  it('never a picture from somewhere else — this is not a way to fetch any address on the internet', () => {
    for (const url of ['https://evil.example/x.png', 'https://pub-abc123.r2.dev.evil.example/x.png', 'http://169.254.169.254/latest', `${BASE}@evil.example/x.png`, 'file:///etc/passwd', 'x', '']) {
      expect(thumbPlan(url, '640', BASE), url).toEqual({ ok: false })
    }
  })
  it('nothing at all when storage has no public address', () => {
    expect(thumbPlan(FILE, '640', '')).toEqual({ ok: false })
    expect(thumbPlan(FILE, '640', undefined)).toEqual({ ok: false })
  })
  it('not a small copy of a small copy, and not what is not a still picture', () => {
    expect(thumbPlan(`${BASE}/thumb/w640/abc.webp`, '640', BASE)).toEqual({ ok: false })
    expect(thumbPlan(`${BASE}/clip.mp4`, '640', BASE)).toEqual({ ok: false })
    expect(thumbPlan(`${BASE}/moving.gif`, '640', BASE)).toEqual({ ok: false })
  })
})
