import { describe, expect, it } from 'vitest'
import { generateJSON } from '@tiptap/html/server'
import { reportHtml } from '@/app/lib/client-report-core'
import { docToMarkdown, type DocNode } from '@/app/lib/report-markdown'
import { reportEditorExtensions } from '@/app/lib/report-editor-schema'

// the owner, 19 Nov 2026: "use tiptap, but this editor should be robust". The report is opened in the editor as the page
// reportHtml draws and saved back as Markdown — so what matters is that opening and saving changes NOTHING on the page.
const open = (md: string) => generateJSON(reportHtml(md), reportEditorExtensions()) as DocNode
const throughTheEditor = (md: string) => docToMarkdown(open(md))

const REPORT = `# Executive Summary

An idea proposed in July **finally shipped** in September, and it is *now* the best post. See [the post](https://www.instagram.com/p/abc123/).

# Things the Data Is Telling Us

- **Reach data has arrived.** 136,678 unique viewers against 287,281 views.
- The funnel finally adds up cleanly.

1. First step
2. Second step

# What Worked

| # | Post | Views | Follows |
| --- | --- | --- | --- |
| 1 | This or That: Turkish vs Greek (13 Sep) | 109,356 | 100 |
| 2 | AI Bertan Baran Lipsync Trend |  | 2 |

*Non-Follower % is the share of that post's viewers who did not already follow the account.*

### 1. This or That: Turkish vs Greek — 13 September

2,709 likes, 229 comments & 431 saves <not a tag>.`

describe('the report, through the editor and back', () => {
  it('opening a report and saving it untouched leaves the page exactly as it was', () => {
    expect(reportHtml(throughTheEditor(REPORT))).toBe(reportHtml(REPORT))
  })

  it('a second trip changes nothing more — the saved text settles', () => {
    const once = throughTheEditor(REPORT)
    expect(throughTheEditor(once)).toBe(once)
  })

  it('keeps headings at their level, lists as lists and the table with its header row', () => {
    const md = throughTheEditor(REPORT)
    expect(md).toContain('# Executive Summary')
    expect(md).toContain('### 1. This or That: Turkish vs Greek — 13 September')
    expect(md).toContain('- **Reach data has arrived.** 136,678 unique viewers against 287,281 views.')
    expect(md).toContain('1. First step\n2. Second step')
    expect(md).toContain('| # | Post | Views | Follows |\n| --- | --- | --- | --- |\n| 1 | This or That: Turkish vs Greek (13 Sep) | 109,356 | 100 |')
    expect(md).toContain('| 2 | AI Bertan Baran Lipsync Trend |  | 2 |')
    expect(md).toContain('[the post](https://www.instagram.com/p/abc123/)')
  })
})

const p = (...content: DocNode[]): DocNode => ({ type: 'paragraph', content })
const t = (text: string, ...marks: string[]): DocNode => ({ type: 'text', text, marks: marks.map(type => ({ type })) })
const doc = (...content: DocNode[]): DocNode => ({ type: 'doc', content })

describe('what a person types is kept as typed', () => {
  it('their own stars, brackets, bars and slashes are never read as formatting', () => {
    const md = docToMarkdown(doc(p(t('+137 new followers* [see note] a|b 5*3*2 c:\\temp'))))
    expect(reportHtml(md)).toBe('<p>+137 new followers* [see note] a|b 5*3*2 c:\\temp</p>')
  })

  it('a line that only looks like a heading, a bullet or a numbered item stays a line of text', () => {
    for (const line of ['# not a heading', '- not a bullet', '1. not a list', '2) nor this', '---'])
      expect(reportHtml(docToMarkdown(doc(p(t(line)))))).toBe(`<p>${line}</p>`)
  })

  it('a bar inside a table cell stays in its cell', () => {
    const cell = (text: string, type = 'tableCell'): DocNode => ({ type, content: [p(t(text))] })
    const table: DocNode = { type: 'table', content: [
      { type: 'tableRow', content: [cell('Metric', 'tableHeader'), cell('Change', 'tableHeader')] },
      { type: 'tableRow', content: [cell('Reels | Stories'), cell('---')] },
    ] }
    expect(reportHtml(docToMarkdown(doc(table)))).toBe(
      '<table><thead><tr><th>Metric</th><th>Change</th></tr></thead><tbody><tr><td>Reels | Stories</td><td>---</td></tr></tbody></table>')
  })

  it('a short row is filled out, so every row has the table’s columns', () => {
    const cell = (text: string): DocNode => ({ type: 'tableCell', content: text ? [p(t(text))] : [p()] })
    const table: DocNode = { type: 'table', content: [
      { type: 'tableRow', content: [cell('A'), cell('B'), cell('C')] },
      { type: 'tableRow', content: [cell('1')] },
    ] }
    expect(docToMarkdown(doc(table))).toBe('| A | B | C |\n| --- | --- | --- |\n| 1 |  |  |')
  })
})

describe('bold, italics and links', () => {
  it('bold and italic together, and runs that touch, come back as they were made', () => {
    const md = docToMarkdown(doc(p(t('plain '), t('both', 'bold', 'italic'), t(' then '), t('bold', 'bold'), t('italic', 'italic'), t('.'))))
    expect(reportHtml(md)).toBe('<p>plain <strong><em>both</em></strong> then <strong>bold</strong><em>italic</em>.</p>')
  })

  it('spaces at the edge of bold text sit outside it, so the stars still close', () => {
    expect(docToMarkdown(doc(p(t('a'), t(' bold ', 'bold'), t('b'))))).toBe('a **bold** b')
  })

  it('only a web address becomes a link — anything else is left as its words', () => {
    const link = (href: string): DocNode => ({ type: 'text', text: 'click', marks: [{ type: 'link', attrs: { href } }] })
    expect(docToMarkdown(doc(p(link('https://example.com/a(b)|c'))))).toBe('[click](https://example.com/a%28b%29%7Cc)')
    expect(docToMarkdown(doc(p(link('javascript:alert(1)'))))).toBe('click')
    expect(reportHtml(docToMarkdown(doc(p(link('https://example.com/x')))))).toBe('<p><a href="https://example.com/x" target="_blank" rel="noreferrer noopener">click</a></p>')
  })
})

describe('what the Markdown cannot hold is flattened, never lost', () => {
  it('a list inside a list becomes items of the one list; empty paragraphs and items are dropped', () => {
    const item = (text: string, ...more: DocNode[]): DocNode => ({ type: 'listItem', content: [p(...(text ? [t(text)] : [])), ...more] })
    const inner: DocNode = { type: 'bulletList', content: [item('inside')] }
    const md = docToMarkdown(doc(p(), { type: 'bulletList', content: [item('one', inner), item(''), item('two')] }, p()))
    expect(md).toBe('- one\n- inside\n- two')
  })

  it('an empty document is an empty report', () => {
    expect(docToMarkdown(doc(p()))).toBe('')
    expect(docToMarkdown(null)).toBe('')
  })
})
