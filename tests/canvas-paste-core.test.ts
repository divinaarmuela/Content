import { describe, expect, it } from 'vitest'
import { pastedTableWidth, tableFromClipboard } from '../app/lib/canvas-paste-core'

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
