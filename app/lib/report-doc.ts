import { reportHtml } from './client-report-core'
import type { DocNode } from './report-markdown'

/**
 * THE REPORT AS A RICH DOCUMENT (the owner, 19 Nov 2026: "why can't I minimise things, add images, resize tables,
 * colours"). The Markdown the report was saved as cannot hold a picture, a column's width, a colour or a section that
 * folds. So an edited report is now ALSO saved as the editor's own document (`body_doc`, JSON as text), and that is
 * what is drawn wherever the report is read. The Markdown `body` is still written beside it — it is what the writer
 * reads as "last month's report", and what a report nobody has edited is drawn from.
 *
 * SAFE BY CONSTRUCTION. The document is data, never markup: this file writes every tag itself, from a short list, and
 * escapes every word. A document that says `<script>` or carries an `onclick` has nowhere to put it — there is no path
 * from the saved text to a tag or an attribute that is not written here. A link or a picture must be a web address;
 * a colour must be a colour. Pure, so it runs the same on the server (the client's portal) and in the browser.
 */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const webAddress = (v: unknown): string | null => {
  const s = String(v ?? '').trim()
  return /^https?:\/\/[^\s<>"']+$/i.test(s) ? s : null
}
/** #1E81FD, rgb(30, 129, 253), rgba(…): a colour and nothing else */
const colour = (v: unknown): string | null => {
  const s = String(v ?? '').trim()
  return /^#[0-9a-f]{3,8}$/i.test(s) || /^rgba?\(\s*[\d.]+%?(\s*,\s*[\d.]+%?){2,3}\s*\)$/i.test(s) ? s : null
}
const px = (v: unknown, min: number, max: number): number | null => {
  const n = Number(v)
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : null
}

function text(n: DocNode): string {
  let out = esc(n.text ?? '')
  if (!out) return ''
  const marks = n.marks ?? []
  const has = (t: string) => marks.find(m => m.type === t)
  const style = colour(has('textStyle')?.attrs?.color)
  if (style) out = `<span style="color:${style}">${out}</span>`
  const hl = has('highlight')
  if (hl) out = `<mark${colour(hl.attrs?.color) ? ` style="background-color:${colour(hl.attrs?.color)}"` : ''}>${out}</mark>`
  if (has('italic')) out = `<em>${out}</em>`
  if (has('bold')) out = `<strong>${out}</strong>`
  const href = webAddress(has('link')?.attrs?.href)
  if (href) out = `<a href="${esc(href)}" target="_blank" rel="noreferrer noopener">${out}</a>`
  return out
}

const kids = (n: DocNode | null | undefined): string => (n?.content ?? []).map(node).join('')

function cell(tag: 'th' | 'td', n: DocNode): string {
  const span = (k: string) => { const v = px(n.attrs?.[k], 2, 50); return v ? ` ${k}="${v}"` : '' }
  // a dragged column keeps its width: the first width of the cell (a merged cell carries one for each column it covers)
  const widths = Array.isArray(n.attrs?.colwidth) ? (n.attrs!.colwidth as unknown[]) : []
  const w = widths.length === 1 ? px(widths[0], 24, 2000) : null
  return `<${tag}${span('colspan')}${span('rowspan')}${w ? ` style="width:${w}px"` : ''}>${kids(n)}</${tag}>`
}

function node(n: DocNode): string {
  switch (n.type) {
    case 'text': return text(n)
    case 'hardBreak': return '<br>'
    case 'paragraph': return `<p>${kids(n)}</p>`
    case 'heading': { const l = Math.min(4, Math.max(2, Number(n.attrs?.level) || 2)); return `<h${l}>${kids(n)}</h${l}>` }
    case 'bulletList': return `<ul>${kids(n)}</ul>`
    case 'orderedList': return `<ol>${kids(n)}</ol>`
    case 'listItem': return `<li>${kids(n)}</li>`
    case 'table': {
      const rows = n.content ?? []
      // a first row made of header cells is the table's head
      const headed = rows.length > 0 && (rows[0].content ?? []).length > 0 && (rows[0].content ?? []).every(c => c.type === 'tableHeader')
      const row = (r: DocNode) => `<tr>${(r.content ?? []).map(c => cell(c.type === 'tableHeader' ? 'th' : 'td', c)).join('')}</tr>`
      return `<div class="report-table"><table>${headed ? `<thead>${row(rows[0])}</thead>` : ''}<tbody>${rows.slice(headed ? 1 : 0).map(row).join('')}</tbody></table></div>`
    }
    case 'image': {
      const src = webAddress(n.attrs?.src)
      if (!src) return ''
      const w = px(n.attrs?.width, 24, 4000)
      return `<img src="${esc(src)}" alt="${esc(String(n.attrs?.alt ?? ''))}" loading="lazy" referrerpolicy="no-referrer"${w ? ` style="width:${w}px"` : ''}>`
    }
    // A SECTION THAT FOLDS: drawn open, so it reads and prints whole; the reader may fold it
    case 'details': return `<details open>${kids(n)}</details>`
    case 'detailsSummary': return `<summary>${kids(n)}</summary>`
    case 'detailsContent': return `<div data-type="detailsContent">${kids(n)}</div>`
    default: return kids(n)
  }
}

/** the editor's document, as the page's HTML */
export function docToHtml(doc: DocNode | null | undefined): string {
  return kids(doc)
}

/** a saved `body_doc` read back: the document, or null when there is none or it cannot be read */
export function readDoc(raw: unknown): DocNode | null {
  if (!raw) return null
  try {
    const d = typeof raw === 'string' ? JSON.parse(raw) as DocNode : raw as DocNode
    return d && typeof d === 'object' && d.type === 'doc' && Array.isArray(d.content) && d.content.length > 0 ? d : null
  } catch { return null }
}

/** THE REPORT, DRAWN — from its rich document when it has one, else from its Markdown. One call for every place the
 *  report is read (the page, earlier versions, the PDF, the client's portal), so they cannot disagree. */
export function reportBodyHtml(r: { body?: string | null; body_doc?: unknown } | null | undefined): string {
  const doc = readDoc(r?.body_doc)
  return doc ? docToHtml(doc) : reportHtml(r?.body ?? '')
}
