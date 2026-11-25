import { describe, expect, it } from 'vitest'
import { shootPrintCss } from '../app/dashboard/production/shoots/[id]/ShootPrintSheet'

describe('the paper the shoot plan prints on', () => {
  // Renee, 25 Nov 2026, after printing it: "just tested the A3, we need it to be landscape"
  it('A3 is the sheet on its side', () => {
    expect(shootPrintCss('A3')).toContain('@page{size:A3 landscape;margin:14mm}')
  })
  // Renee, 25 Nov 2026, on the first landscape print: "organised abit weird … would be great if it's shown photos
  // all together, vid 1 all together" — a section ran from one column into the next and its pictures split
  it('on A3 a section is kept together: its words on the left, its pictures beside them, as on the board', () => {
    const css = shootPrintCss('A3')
    expect(css).not.toContain('.sp-body{column-count')
    // …but never by leaving the rest of a sheet blank (Renee, on the next print: "the part where it waste 1 sheet of paper")
    expect(css).not.toContain('.sp-sec{break-inside:avoid}')
    expect(css).toContain('.sp-both{display:grid;grid-template-columns:120mm 1fr;')
    expect(css).toContain('.sp-both > .sp-pics{grid-column:2')
    // one or two pictures do not take two thirds of the sheet from a long script
    expect(css).toContain('.sp-few{grid-template-columns:1fr 100mm}')
  })
  it('A4 stays upright in one column', () => {
    const css = shootPrintCss('A4')
    expect(css).toContain('@page{size:A4;margin:14mm}')
    expect(css).not.toContain('column-count')
  })
})

import { sectionShape } from '../app/dashboard/production/shoots/[id]/ShootPrintSheet'

describe('how a section sits on the wide sheet', () => {
  const words = (text: string) => ({ kind: 'words' as const, id: 'w', text })
  const pics = (n: number) => Array.from({ length: n }, (_, i) => ({ kind: 'picture' as const, id: `p${i}`, url: 'https://x/p.jpg' }))
  const sec = (blocks: ReturnType<typeof words>[], n: number) => ({ id: 's', title: 'S', depth: 0, blocks, pictures: pics(n) })
  it('a script with a wall of pictures: words on the left, pictures beside them', () => {
    expect(sectionShape(sec([words('x'.repeat(400))], 12))).toBe('both')
  })
  it('a script with a picture or two keeps most of the sheet for the words', () => {
    expect(sectionShape(sec([words('x'.repeat(400))], 2))).toBe('few')
  })
  // Renee's print, 25 Nov 2026: PHOTOS had one line of words, which took a whole column and pushed 4 pictures to the next page
  it('a line or two of words over a wall of pictures does not take a column from them', () => {
    expect(sectionShape(sec([words("ALIA at teta's table photo inspo")], 25))).toBe('stack')
  })
  it('words alone, or pictures alone, are simply stacked', () => {
    expect(sectionShape(sec([words('x'.repeat(400))], 0))).toBe('stack')
    expect(sectionShape(sec([], 9))).toBe('stack')
  })
})

import { boardBounds, fitBoardToPage } from '../app/lib/shoot-print-core'
import { boardPrintCss } from '../app/dashboard/production/shoots/[id]/ShootPrintSheet'

describe('the board printed as it looks on the screen', () => {
  // Renee, 25 Nov 2026: "we need it to be landscape … and similar to the one on screen too"
  it('the board is the box around every card', () => {
    expect(boardBounds([])).toBeNull()
    expect(boardBounds([{ x: 100, y: 50, w: 200, h: 100 }, { x: -40, y: 300, w: 60, h: 500 }])).toEqual({ x: -40, y: 50, w: 340, h: 750 })
  })
  it('a wide board is shrunk to the width of the page and sits in the middle of it', () => {
    const fit = fitBoardToPage({ x: 10, y: 20, w: 3000, h: 1000 }, { w: 1500, h: 1000 })
    expect(fit.scale).toBe(0.5)
    expect(fit).toMatchObject({ left: 0, top: 250 })
  })
  it('a tall board is shrunk to the height of the page', () => {
    const fit = fitBoardToPage({ x: 0, y: 0, w: 1000, h: 4000 }, { w: 1500, h: 1000 })
    expect(fit.scale).toBe(0.25)
    expect(fit).toMatchObject({ left: 625, top: 0 })
  })
  it('a small board is not blown up past twice its size', () => {
    expect(fitBoardToPage({ x: 0, y: 0, w: 100, h: 100 }, { w: 1500, h: 1000 }).scale).toBe(2)
  })
  it('it prints on one A3 sheet on its side, colours kept', () => {
    const css = boardPrintCss()
    expect(css).toContain('@page{size:A3 landscape;margin:10mm}')
    expect(css).toContain('print-color-adjust:exact')
  })
})
