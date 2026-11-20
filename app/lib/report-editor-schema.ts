import { Node, type AnyExtension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import Image from '@tiptap/extension-image'
import { Color, TextStyle } from '@tiptap/extension-text-style'
import Highlight from '@tiptap/extension-highlight'
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details'
import { FIGURE_KINDS, FIGURE_NODE } from './report-figures'

/**
 * A FIGURE OF THE REPORT, AS A BLOCK (20 Nov 2026, report-figures.ts): the summary table, an account's tiles, a chart…
 * The block holds only WHICH figure it is; the numbers are read from the month's figures wherever it is drawn. One
 * whole piece: it is moved or removed, never typed into. The editor gives it its drawing (ReportEditor.tsx).
 */
export const ReportFigureNode = Node.create({
  name: FIGURE_NODE,
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      kind: { default: 'tiles', parseHTML: el => { const k = el.getAttribute('data-kind') ?? ''; return (FIGURE_KINDS as readonly string[]).includes(k) ? k : 'tiles' }, renderHTML: a => ({ 'data-kind': a.kind }) },
      platform: { default: '', parseHTML: el => el.getAttribute('data-platform') ?? '', renderHTML: a => ({ 'data-platform': a.platform }) },
      hide: {
        default: [],
        parseHTML: el => { try { const v = JSON.parse(el.getAttribute('data-hide') ?? '[]'); return Array.isArray(v) ? v.filter(x => typeof x === 'string') : [] } catch { return [] } },
        renderHTML: a => ({ 'data-hide': JSON.stringify(a.hide ?? []) }),
      },
    }
  },
  parseHTML() { return [{ tag: 'div[data-report-figure]' }] },
  renderHTML({ HTMLAttributes }) { return ['div', { 'data-report-figure': '', ...HTMLAttributes }] },
})

/**
 * WHAT THE REPORT EDITOR CAN HOLD — exactly what the saved document can draw (report-doc.ts), and no more: a thing the
 * editor let someone make that the page then quietly dropped would be a lie on the page. Headings, bold, italics,
 * links, lists, tables (columns dragged to a width, cells merged), pictures (dragged to a size), text colour, a
 * highlight, sections that fold (the owner, 19 Nov 2026), and the report's own figures as blocks (20 Nov 2026). Still no quotes, code, strike-through, underline or
 * rules — report-doc.ts does not draw them.
 * Shared by the editor and its tests, so the two can never drift apart.
 */
export const reportEditorExtensions = (figure: AnyExtension = ReportFigureNode) => [
  StarterKit.configure({
    heading: { levels: [2, 3, 4] },
    blockquote: false, code: false, codeBlock: false, strike: false, underline: false, horizontalRule: false, hardBreak: false,
    link: { openOnClick: false, autolink: true, linkOnPaste: true, protocols: ['http', 'https'], HTMLAttributes: { rel: 'noreferrer noopener', target: '_blank' } },
  }),
  // a column's edge is grabbed within 10px of it (5 was easy to miss: the owner, 19 Nov 2026, "resizing table doesn't work")
  Table.configure({ resizable: true, handleWidth: 10, cellMinWidth: 60, lastColumnResizable: true }),
  TableRow, TableHeader, TableCell,
  Image.configure({ inline: false, allowBase64: false, resize: { enabled: true, directions: ['bottom-right', 'bottom-left', 'top-right', 'top-left'], minWidth: 60, minHeight: 40, alwaysPreserveAspectRatio: true } }),
  TextStyle, Color,
  Highlight.configure({ multicolor: true }),
  Details.configure({ persist: true, HTMLAttributes: { class: 'report-fold' } }),
  DetailsSummary, DetailsContent,
  figure,
]
