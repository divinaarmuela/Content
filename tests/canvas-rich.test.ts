import { describe, expect, it } from 'vitest'
import { htmlText, milanoteToHtml, sanitiseCanvasHtml, wordCount } from '../app/lib/canvas-rich-core'

/** RICH TEXT ON THE CANVAS (20 Oct 2026, the Milanote merge) — Milanote's shape kept, nothing unsafe let through. */
describe('sanitiseCanvasHtml', () => {
  it('keeps the shapes Milanote uses', () => {
    const html = '<h2>Brand</h2><p><strong>Name:</strong> <em>Duru</em> <u>u</u> <s>s</s></p><ol><li>one</li></ol><blockquote>q</blockquote>'
    expect(sanitiseCanvasHtml(html)).toBe(html)
  })
  it('drops scripts, handlers and unsafe links', () => {
    expect(sanitiseCanvasHtml('<p onclick="x()">hi<script>alert(1)</script></p>')).toBe('<p>hialert(1)</p>')
    expect(sanitiseCanvasHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>')
    expect(sanitiseCanvasHtml('<a href="https://ok.com/a">x</a>')).toBe('<a href="https://ok.com/a" target="_blank" rel="noreferrer noopener">x</a>')
  })
  it('keeps a colour only as a hex', () => {
    expect(sanitiseCanvasHtml('<span style="color:#d0db85;font-size:99px">x</span>')).toBe('<span style="color:#d0db85">x</span>')
    expect(sanitiseCanvasHtml('<span style="color:red">x</span>')).toBe('<span>x</span>')
  })
  it('closes what it opens', () => {
    expect(sanitiseCanvasHtml('<p><strong>open')).toBe('<p><strong>open</strong></p>')
  })
})

describe("Milanote's text", () => {
  it('turns a Milanote note into our HTML (a real one: MGMT, 20 Oct)', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph', attrs: { key: 'MmumZ', textAlign: 'left' }, content: [{ type: 'text', marks: [{ type: 'textStyle', attrs: { color: null } }, { type: 'bold' }], text: 'Reel 3: Agent Insight' }] }] }
    expect(milanoteToHtml(doc)).toBe('<p><strong>Reel 3: Agent Insight</strong></p>')
  })
  it('keeps lists, links, italics and coloured words', () => {
    const doc = { type: 'doc', content: [
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hook', marks: [{ type: 'italic' }] }] }] }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'ref', marks: [{ type: 'link', attrs: { href: 'https://www.instagram.com/p/x/' } }] }, { type: 'text', text: ' green', marks: [{ type: 'textStyle', attrs: { color: '#96b74a' } }] }] },
    ] }
    expect(milanoteToHtml(doc)).toBe('<ul><li><p><em>Hook</em></p></li></ul><p><a href="https://www.instagram.com/p/x/" target="_blank" rel="noreferrer noopener">ref</a><span style="color:#96b74a"> green</span></p>')
  })
  it("reads a table cell's older draft-js text", () => {
    const cell = '@@mn-draft-js:{"blocks":[{"key":"47abh","text":"Metric","type":"unstyled","depth":0,"inlineStyleRanges":[{"offset":0,"length":6,"style":"BOLD"}],"entityRanges":[],"data":{}}],"entityMap":{}}'
    expect(milanoteToHtml(cell)).toBe('<p><strong>Metric</strong></p>')
  })
  it('counts the words of a document, as Milanote shows them', () => {
    expect(wordCount('<p>Script hooks and <strong>trigger</strong> questions</p>')).toBe(5)
    expect(htmlText('<p>a</p><ul><li>b</li></ul>')).toBe('a\nb')
  })
})

import { milanoteToHtml as mnHtml } from '../app/lib/canvas-rich-core'
describe("Milanote's named highlighters (20 Oct 2026)", () => {
  it('keep their colour, as Milanote draws them', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'SCRIPT', marks: [{ type: 'highlight', attrs: { color: 'blue' } }] }] }] }
    expect(mnHtml(doc)).toContain('<mark style="background-color:#8ae0ff">SCRIPT</mark>')
  })
})
