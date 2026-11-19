import { describe, expect, it } from 'vitest'
import { generateJSON } from '@tiptap/html/server'
import { reportHtml } from '@/app/lib/client-report-core'
import { docToHtml, readDoc, reportBodyHtml } from '@/app/lib/report-doc'
import { docToMarkdown, type DocNode } from '@/app/lib/report-markdown'
import { reportEditorExtensions } from '@/app/lib/report-editor-schema'

// the owner, 19 Nov 2026: "why can't I minimise things, add images, resize tables, colours". An edited report is saved
// as the editor's document and drawn from it. The document is data: nothing in it can become markup of its own.
const p = (...content: DocNode[]): DocNode => ({ type: 'paragraph', content })
const t = (text: string, ...marks: { type: string; attrs?: Record<string, unknown> }[]): DocNode => ({ type: 'text', text, marks })
const doc = (...content: DocNode[]): DocNode => ({ type: 'doc', content })

describe('what the document can draw', () => {
  it('a picture at its dragged width, colour, a highlight, and a section that folds, drawn open', () => {
    const html = docToHtml(doc(
      { type: 'image', attrs: { src: 'https://media.example.com/a.png', alt: 'The team "on set"', width: 320.4 } },
      p(t('blue', { type: 'textStyle', attrs: { color: '#1E81FD' } }), t(' and '), t('marked', { type: 'highlight', attrs: { color: '#FFF1A8' } })),
      { type: 'details', content: [{ type: 'detailsSummary', content: [t('More detail')] }, { type: 'detailsContent', content: [p(t('Inside.'))] }] },
    ))
    expect(html).toContain('<img src="https://media.example.com/a.png" alt="The team &quot;on set&quot;" loading="lazy" referrerpolicy="no-referrer" style="width:320px">')
    expect(html).toContain('<span style="color:#1E81FD">blue</span> and <mark style="background-color:#FFF1A8">marked</mark>')
    expect(html).toContain('<details open><summary>More detail</summary><div data-type="detailsContent"><p>Inside.</p></div></details>')
  })

  it('a table keeps its header row, a dragged column’s width and its merged cells', () => {
    const cell = (type: string, text: string, attrs?: Record<string, unknown>): DocNode => ({ type, attrs, content: [p(t(text))] })
    const html = docToHtml(doc({ type: 'table', content: [
      { type: 'tableRow', content: [cell('tableHeader', 'Metric', { colwidth: [180] }), cell('tableHeader', 'Change')] },
      { type: 'tableRow', content: [cell('tableCell', 'Both', { colspan: 2 })] },
    ] }))
    expect(html).toBe('<div class="report-table"><table><thead><tr><th style="width:180px"><p>Metric</p></th><th><p>Change</p></th></tr></thead><tbody><tr><td colspan="2"><p>Both</p></td></tr></tbody></table></div>')
  })
})

describe('nothing in a saved document can become markup of its own', () => {
  it('words are escaped; an unknown node or mark draws only its words', () => {
    const html = docToHtml(doc(
      p(t('<script>alert(1)</script> & "quotes"')),
      { type: 'script', content: [p(t('inside'))] },
      p(t('x', { type: 'onclick', attrs: { value: 'alert(1)' } })),
    ))
    expect(html).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot;</p><p>inside</p><p>x</p>')
  })

  it('a link or a picture that is not a web address is not drawn as one', () => {
    const html = docToHtml(doc(
      p(t('click', { type: 'link', attrs: { href: 'javascript:alert(1)' } })),
      { type: 'image', attrs: { src: 'data:image/svg+xml,<svg onload=alert(1)>' } },
      { type: 'image', attrs: { src: 'https://ok.example.com/a.png" onerror="alert(1)' } },
    ))
    expect(html).toBe('<p>click</p>')
  })

  it('a colour that is not a colour is dropped, and a width is only ever a number', () => {
    const html = docToHtml(doc(
      p(t('a', { type: 'textStyle', attrs: { color: 'red;background:url(https://evil.example/x)' } }), t('b', { type: 'highlight', attrs: { color: 'expression(alert(1))' } })),
      { type: 'image', attrs: { src: 'https://ok.example.com/a.png', width: '100px;position:fixed' } },
    ))
    expect(html).toBe('<p>a<mark>b</mark></p><img src="https://ok.example.com/a.png" alt="" loading="lazy" referrerpolicy="no-referrer">')
  })
})

describe('which one is drawn', () => {
  it('the document when there is one, the Markdown when there is not or it cannot be read', () => {
    const saved = JSON.stringify(doc(p(t('From the document'))))
    expect(reportBodyHtml({ body: '# From the Markdown', body_doc: saved })).toBe('<p>From the document</p>')
    expect(reportBodyHtml({ body: '# From the Markdown', body_doc: null })).toBe(reportHtml('# From the Markdown'))
    expect(reportBodyHtml({ body: '# From the Markdown', body_doc: '{not json' })).toBe(reportHtml('# From the Markdown'))
    expect(reportBodyHtml({ body: '# From the Markdown', body_doc: JSON.stringify({ type: 'doc', content: [] }) })).toBe(reportHtml('# From the Markdown'))
    expect(readDoc('"a string"')).toBeNull()
  })
})

describe('the editor and the page agree', () => {
  it('what the page draws, the editor reads back as the same document', () => {
    const d = doc(
      { type: 'heading', attrs: { level: 2 }, content: [t('What Worked')] },
      p(t('Plain, '), t('bold', { type: 'bold' }), t(' and '), t('blue', { type: 'textStyle', attrs: { color: '#1E81FD' } }), t('.')),
      { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('one'))] }] },
    )
    const html = docToHtml(d)
    expect(docToHtml(generateJSON(html, reportEditorExtensions()) as DocNode)).toBe(html)
  })

  it('the Markdown kept beside the document still says its words: a fold’s title is a sub-heading, a picture is left out', () => {
    const md = docToMarkdown(doc(
      { type: 'image', attrs: { src: 'https://media.example.com/a.png' } },
      { type: 'details', content: [{ type: 'detailsSummary', content: [t('More detail')] }, { type: 'detailsContent', content: [p(t('Inside.'))] }] },
      p(t('coloured', { type: 'textStyle', attrs: { color: '#1E81FD' } })),
    ))
    expect(md).toBe('### More detail\n\nInside.\n\ncoloured')
  })
})
