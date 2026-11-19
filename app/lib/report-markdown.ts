/**
 * THE REPORT EDITOR'S WAY BACK TO TEXT (19 Nov 2026: the owner, "use tiptap … editing, creating tables, a toolbar like
 * Google Docs"). The written report is still saved as the small Markdown `reportHtml` reads (client-report-core.ts), so
 * the PDF, the client's portal and every earlier version keep working unchanged. The editor shows that Markdown as a
 * page; this turns the page back into the Markdown on Save. Pure: no editor, no browser — the editor hands over its
 * document as plain JSON.
 *
 * What the Markdown can hold is what the toolbar offers: three headings, bold, italics, links, bullet and numbered
 * lists, and tables with a header row. A table cell is one line of text, and lists are one level deep.
 */

export type DocNode = {
  type?: string
  text?: string
  attrs?: Record<string, unknown> | null
  marks?: { type: string; attrs?: Record<string, unknown> | null }[]
  content?: DocNode[]
}

const ZWSP = '​'

/** a person's own `*`, `[`, `]`, `|` and `\` are kept as typed, never read as formatting */
const escText = (s: string) => s.replace(/[\\*[\]|]/g, '\\$&')

/** a line that only LOOKS like a heading, a list item or a table's dashes stays a line of text */
function escLineStart(line: string): string {
  if (/^#{1,6}\s/.test(line)) return `\\${line}`
  if (/^[-•](\s|$)/.test(line) || /^:?-{2,}:?$/.test(line)) return `\\${line}`
  const n = line.match(/^(\d+)([.)])(\s.*|)$/)
  if (n) return `${n[1]}\\${n[2]}${n[3]}`
  return line
}

/** only a web address can be a link; the characters that would end it early are encoded */
function linkHref(raw: unknown): string | null {
  const href = String(raw ?? '').trim()
  if (!/^https?:\/\/\S+$/i.test(href)) return null
  return href.replace(/[\\*[\]|()]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

/** the words of a paragraph, heading, list item or cell, with their bold, italics and links */
function inline(nodes: DocNode[] | undefined): string {
  const parts: string[] = []
  for (const n of nodes ?? []) {
    if (n.type === 'hardBreak') { parts.push(' '); continue }
    if (n.type !== 'text' || !n.text) { if (n.content) parts.push(inline(n.content)); continue }
    const text = n.text.split(ZWSP).join('').replace(/\s+/g, ' ')
    if (!text) continue
    const lead = text.match(/^\s*/)?.[0] ?? ''
    const core = text.slice(lead.length).replace(/\s+$/, '')
    const trail = text.slice(lead.length + core.length)
    if (!core) { parts.push(text); continue }
    const marks = new Set((n.marks ?? []).map(m => m.type))
    let s = escText(core)
    if (marks.has('bold') && marks.has('italic')) s = `***${s}***`
    else if (marks.has('bold')) s = `**${s}**`
    else if (marks.has('italic')) s = `*${s}*`
    const href = marks.has('link') ? linkHref(n.marks?.find(m => m.type === 'link')?.attrs?.href) : null
    if (href) s = `[${s}](${href})`
    parts.push(lead + s + trail)
  }
  // two formatted runs that touch (bold straight into italics) are kept apart, so their stars are never read as one
  let out = ''
  for (const p of parts) out += out.endsWith('*') && p.startsWith('*') ? ZWSP + p : p
  return out.replace(/ {2,}/g, ' ').trim()
}

/** every paragraph inside a list item or a cell, as one line */
const oneLine = (n: DocNode): string =>
  (n.content ?? []).filter(c => c.type !== 'bulletList' && c.type !== 'orderedList')
    .map(c => (c.type === 'text' ? inline([c]) : inline(c.content))).filter(Boolean).join(' ')

function listLines(list: DocNode): string[] {
  const ordered = list.type === 'orderedList'
  const lines: string[] = []
  let i = 0
  for (const item of list.content ?? []) {
    const text = oneLine(item)
    if (text) { i++; lines.push(`${ordered ? `${i}.` : '-'} ${text}`) }
    // a list inside a list: its items follow, one level (the Markdown has no deeper)
    for (const c of item.content ?? []) if (c.type === 'bulletList' || c.type === 'orderedList') lines.push(...listLines(c))
  }
  return lines
}

function tableLines(table: DocNode): string[] {
  const rows = (table.content ?? []).map(r => (r.content ?? []).map(c => escLineStart(oneLine(c))))
  const width = Math.max(0, ...rows.map(r => r.length))
  if (!rows.length || !width) return []
  const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, k) => cells[k] ?? '').join(' | ')} |`
  const [head, ...rest] = rows
  return [line(head), line(Array.from({ length: width }, () => '---')), ...rest.map(line)]
}

function blocks(nodes: DocNode[] | undefined, out: string[]): void {
  for (const n of nodes ?? []) {
    switch (n.type) {
      case 'paragraph': { const t = inline(n.content); if (t) out.push(escLineStart(t)); break }
      case 'heading': {
        const t = inline(n.content)
        // reportHtml reads `#` as the page's h2, `##` as h3, `###` as h4
        const level = Math.min(4, Math.max(2, Number(n.attrs?.level) || 2))
        if (t) out.push(`${'#'.repeat(level - 1)} ${t}`)
        break
      }
      case 'bulletList': case 'orderedList': { const l = listLines(n); if (l.length) out.push(l.join('\n')); break }
      case 'table': { const l = tableLines(n); if (l.length) out.push(l.join('\n')); break }
      // a section that folds: its title is a sub-heading, its inside follows (the Markdown has no fold)
      case 'detailsSummary': { const t = inline(n.content); if (t) out.push(`### ${t}`); break }
      default: blocks(n.content, out)
    }
  }
}

/** the editor's document, as the report's Markdown */
export function docToMarkdown(doc: DocNode | null | undefined): string {
  const out: string[] = []
  blocks(doc?.content, out)
  return out.join('\n\n')
}
