import StarterKit from '@tiptap/starter-kit'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'

/**
 * WHAT THE REPORT EDITOR CAN HOLD — exactly what the saved Markdown can (report-markdown.ts), and no more: a thing the
 * editor let someone make that Save then quietly dropped would be a lie on the page. So no quotes, code, strike-through,
 * underline, rules or line breaks inside a paragraph; a table cell is one line; tables are not resized or merged.
 * Shared by the editor and its round-trip test, so the two can never drift apart.
 */
const oneLineCell = { content: 'paragraph' }

export const reportEditorExtensions = () => [
  StarterKit.configure({
    heading: { levels: [2, 3, 4] },
    blockquote: false, code: false, codeBlock: false, strike: false, underline: false, horizontalRule: false, hardBreak: false,
    link: { openOnClick: false, autolink: true, linkOnPaste: true, protocols: ['http', 'https'], HTMLAttributes: { rel: 'noreferrer noopener', target: '_blank' } },
  }),
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader.extend(oneLineCell),
  TableCell.extend(oneLineCell),
]
