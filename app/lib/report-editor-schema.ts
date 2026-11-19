import StarterKit from '@tiptap/starter-kit'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import Image from '@tiptap/extension-image'
import { Color, TextStyle } from '@tiptap/extension-text-style'
import Highlight from '@tiptap/extension-highlight'
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details'

/**
 * WHAT THE REPORT EDITOR CAN HOLD — exactly what the saved document can draw (report-doc.ts), and no more: a thing the
 * editor let someone make that the page then quietly dropped would be a lie on the page. Headings, bold, italics,
 * links, lists, tables (columns dragged to a width, cells merged), pictures (dragged to a size), text colour, a
 * highlight, and sections that fold (the owner, 19 Nov 2026). Still no quotes, code, strike-through, underline or
 * rules — report-doc.ts does not draw them.
 * Shared by the editor and its tests, so the two can never drift apart.
 */
export const reportEditorExtensions = () => [
  StarterKit.configure({
    heading: { levels: [2, 3, 4] },
    blockquote: false, code: false, codeBlock: false, strike: false, underline: false, horizontalRule: false, hardBreak: false,
    link: { openOnClick: false, autolink: true, linkOnPaste: true, protocols: ['http', 'https'], HTMLAttributes: { rel: 'noreferrer noopener', target: '_blank' } },
  }),
  Table.configure({ resizable: true, cellMinWidth: 60, lastColumnResizable: true }),
  TableRow, TableHeader, TableCell,
  Image.configure({ inline: false, allowBase64: false, resize: { enabled: true, directions: ['bottom-right', 'bottom-left', 'top-right', 'top-left'], minWidth: 60, minHeight: 40, alwaysPreserveAspectRatio: true } }),
  TextStyle, Color,
  Highlight.configure({ multicolor: true }),
  Details.configure({ persist: true, HTMLAttributes: { class: 'report-fold' } }),
  DetailsSummary, DetailsContent,
]
