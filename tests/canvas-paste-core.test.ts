import { describe, expect, it } from 'vitest'
import { isLocalOnly, linkFromClipboard, pastedTableWidth, savable, tableFromClipboard } from '../app/lib/canvas-paste-core'

describe('a table pasted on a board (26 Oct 2026)', () => {
  it('reads the HTML table ChatGPT and Claude put on the clipboard, header and bold kept', () => {
    const html = '<p>Here:</p><table><thead><tr><th>Day</th><th>Post</th></tr></thead><tbody><tr><td>Mon</td><td><strong>Reel</strong></td></tr><tr><td>Tue</td><td>Carousel</td></tr></tbody></table>'
    expect(tableFromClipboard(html, 'ignored')).toEqual({ header: true, rows: [['Day', 'Post'], ['Mon', '<strong>Reel</strong>'], ['Tue', 'Carousel']] })
  })
  it('reads a Markdown table from a plain-text copy', () => {
    const md = 'Plan:\n\n| Day | Post |\n|---|:---:|\n| Mon | **Reel** |\n| Tue | Carousel |\n'
    expect(tableFromClipboard('', md)).toEqual({ header: true, rows: [['Day', 'Post'], ['Mon', '<b>Reel</b>'], ['Tue', 'Carousel']] })
  })
  it('reads a spreadsheet copied as tabs, and squares ragged rows', () => {
    expect(tableFromClipboard(null, 'a\tb\tc\n1\t2\n')).toEqual({ header: true, rows: [['a', 'b', 'c'], ['1', '2', '']] })
  })
  it('leaves ordinary text alone', () => {
    expect(tableFromClipboard('<p>hello</p>', 'just a sentence | with a pipe')).toBeNull()
    expect(tableFromClipboard(null, 'one line\ttab only')).toBeNull()
  })
  it('escapes text so a pasted cell cannot carry markup', () => {
    expect(tableFromClipboard('', '| a |\n|---|\n| <img src=x> |')!.rows[1][0]).toBe('&lt;img src=x&gt;')
  })
  it('sizes the card to its columns', () => {
    expect(pastedTableWidth({ header: true, rows: [['a', 'b', 'c']] })).toBe(510)
  })
})

/**
 * A LINK PASTED STRAIGHT ONTO A BOARD (Renee, 25 Nov 2026: a Pinterest link "takes at least 4 times before the image
 * appears"). Ctrl+V with a link on the clipboard did nothing at all; the link had to go through the Link box.
 */
describe('a link pasted on a board', () => {
  it('is the link when the clipboard holds one https link', () => {
    expect(linkFromClipboard('https://pin.it/4l5rUrhWy')).toBe('https://pin.it/4l5rUrhWy')
    expect(linkFromClipboard('  https://au.pinterest.com/pin/2744449762551745/\n')).toBe('https://au.pinterest.com/pin/2744449762551745/')
  })
  it('is nothing when the clipboard holds words, or words around a link', () => {
    expect(linkFromClipboard('')).toBeNull()
    expect(linkFromClipboard(null)).toBeNull()
    expect(linkFromClipboard('golden hour')).toBeNull()
    expect(linkFromClipboard('see https://pin.it/4l5rUrhWy')).toBeNull()
    expect(linkFromClipboard('https://a.com https://b.com')).toBeNull()
  })
  it('is nothing for a link that is not https, or not a link at all', () => {
    expect(linkFromClipboard('http://example.com/a')).toBeNull()
    expect(linkFromClipboard('https://')).toBeNull()
    expect(linkFromClipboard('https://localhost/x')).toBeNull()
  })
})

/**
 * A PASTED PICTURE SHOWS AT ONCE (the owner, 25 Nov 2026: "copying an image online and pasting it to the board is
 * slow, why"). The card used to appear only when the upload had finished. Now it appears straight away, showing the
 * picture from the person's own machine, and takes its stored address when the upload lands — and until then it is
 * never saved, because an address that only exists in this browser tab means nothing to anyone else.
 */
describe('a picture still uploading is not saved', () => {
  const pic = (id: string, url: string) => ({ id, kind: 'image' as const, x: 0, y: 0, w: 240, z: 1, url })
  it('knows a card whose picture only exists in this tab', () => {
    expect(isLocalOnly(pic('a', 'blob:https://app.test/1234'))).toBe(true)
    expect(isLocalOnly(pic('b', 'https://cdn.test/a.jpg'))).toBe(false)
    const note: { id: string; url?: string } = { id: 'n' }
    expect(isLocalOnly(note)).toBe(false)
  })
  it('keeps those cards out of a save, and lets every other card through', () => {
    const cards = [pic('a', 'blob:https://app.test/1234'), pic('b', 'https://cdn.test/a.jpg')]
    expect(savable(cards).map(c => c.id)).toEqual(['b'])
  })
})
