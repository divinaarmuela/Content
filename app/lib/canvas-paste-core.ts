/**
 * PASTE A TABLE ONTO A BOARD (the owner, 26 Oct 2026 — Renee's Milanote habit: copy a table out of ChatGPT or
 * Claude, paste it on the board, and it lands as a table, exactly). Pure: what the clipboard held in, the
 * rows out. Three shapes, best first:
 *   • HTML — what ChatGPT, Claude, Google Sheets, Excel and Docs put on the clipboard: the <table> itself;
 *   • Markdown — "| a | b |" lines with a "|---|" rule, which a plain-text copy of an AI answer gives;
 *   • tab-separated — a spreadsheet copied as plain text.
 * Nothing that is not plainly a table (two rows, or two columns) is taken: a pasted sentence stays a sentence.
 * Cells come out as HTML; the canvas sanitiser (sanitiseCanvasHtml) is what makes them safe, as for every card.
 */
export type PastedTable = { rows: string[][]; header: boolean }

const MAX_ROWS = 200
const MAX_COLS = 40

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
/** a Markdown cell's own marks — bold, italic, code — as the HTML the table draws */
function mdInline(t: string): string {
  return esc(t.trim())
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/__(.+?)__/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<i>$2</i>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/&lt;br\s*\/?&gt;/gi, '<br>')
}

/** every row the same width, so a ragged paste is still a rectangle */
function squared(rows: string[][], header: boolean): PastedTable | null {
  const kept = rows.slice(0, MAX_ROWS).map(r => r.slice(0, MAX_COLS))
  const width = Math.max(0, ...kept.map(r => r.length))
  if (kept.length < 2 && width < 2) return null
  if (width === 0) return null
  return { rows: kept.map(r => [...r, ...Array(width - r.length).fill('')]), header }
}

export function tableFromHtml(html: string | null | undefined): PastedTable | null {
  const m = /<table[\s\S]*?<\/table>/i.exec(String(html ?? ''))
  if (!m) return null
  const rows: string[][] = []
  let allHeads = true
  for (const tr of m[0].match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
    const cells: string[] = []
    let heads = true
    for (const c of tr.matchAll(/<t([hd])\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)) {
      if (c[1].toLowerCase() !== 'h') heads = false
      cells.push(c[2].trim())
    }
    if (cells.length === 0) continue
    if (rows.length === 0) allHeads = heads
    rows.push(cells)
  }
  // a <thead> says so outright; otherwise a first row of <th> is the header
  const header = /<thead/i.test(m[0]) || allHeads
  return squared(rows, header)
}

const RULE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/
export function tableFromMarkdown(text: string | null | undefined): PastedTable | null {
  const lines = String(text ?? '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  const tableLines = lines.filter(l => l.includes('|'))
  if (tableLines.length < 2) return null
  const ruleAt = tableLines.findIndex(l => RULE.test(l))
  if (ruleAt < 1) return null
  const rows = tableLines
    .filter((l, i) => i !== ruleAt && !RULE.test(l))
    .map(l => l.replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(c => mdInline(c.replace(/\\\|/g, '|'))))
  return squared(rows, ruleAt === 1)
}

export function tableFromTabs(text: string | null | undefined): PastedTable | null {
  const lines = String(text ?? '').replace(/\r/g, '').split('\n').filter(l => l.trim() !== '')
  if (lines.length < 2 || !lines.every(l => l.includes('\t'))) return null
  return squared(lines.map(l => l.split('\t').map(c => esc(c.trim()))), true)
}

/** the table a paste holds, if it holds one — HTML first, because it keeps bold and links */
export function tableFromClipboard(html: string | null | undefined, text: string | null | undefined): PastedTable | null {
  return tableFromHtml(html) ?? tableFromMarkdown(text) ?? tableFromTabs(text)
}

/** how wide the new card should be: room for each column, within reason */
export function pastedTableWidth(t: PastedTable): number {
  const cols = t.rows[0]?.length ?? 1
  return Math.min(1400, Math.max(320, cols * 170))
}
