/**
 * DOT POINTS AND HIGHLIGHTS IN A NOTE (Manal, 20 Oct 2026, a photo of a shoot board note: a list of prompts
 * highlighted, "she wants it to be highlighted and make it dot points").
 *
 * A note is plain words with **bold** runs (batch-brief-core). Two more, the same way:
 *   • a dot point is a line starting "• " — the toolbar's Dot points turns the highlighted lines into dot points (or
 *     back), and Enter on a dot point starts the next one (Enter on an empty one ends the list);
 *   • a highlight is ==a run== — the toolbar's Highlight marks the highlighted words (or clears them), and the note
 *     draws them on a highlighter colour.
 * Pure.
 */

export const BULLET = '• '

type Edit = { text: string; start: number; end: number }

/** the whole lines a selection touches: from the start of its first line to the end of its last */
function lineSpan(text: string, start: number, end: number): [number, number] {
  const from = text.lastIndexOf('\n', Math.max(0, start - 1)) + 1
  const lastChar = end > start && text[end - 1] === '\n' ? end - 1 : end
  const nl = text.indexOf('\n', lastChar)
  return [start === 0 ? 0 : from, nl === -1 ? text.length : nl]
}

/** Dot points on the lines picked — or off, when every one of them already is one. Blank lines are left alone. */
export function toggleBullets(text: string, start: number, end: number): Edit {
  const [a, b] = lineSpan(text, start, end)
  const lines = text.slice(a, b).split('\n')
  const filled = lines.filter(l => l.trim() !== '')
  const allOn = filled.length > 0 && filled.every(l => l.startsWith(BULLET))
  const next = lines.map(l => (l.trim() === '' ? l : allOn ? l.slice(BULLET.length) : l.startsWith(BULLET) ? l : BULLET + l)).join('\n')
  const out = text.slice(0, a) + next + text.slice(b)
  return { text: out, start: a, end: a + next.length }
}

/** Enter on a dot point: the next line is a dot point too; Enter on an empty dot point ends the list. */
export function continueBullet(text: string, caret: number): { text: string; caret: number } | null {
  const lineStart = text.lastIndexOf('\n', caret - 1) + 1
  const line = text.slice(lineStart, caret)
  if (!line.startsWith(BULLET)) return null
  const rest = text.slice(caret)
  if (line === BULLET && (rest === '' || rest.startsWith('\n'))) {
    // an empty dot point: the list is over — the bullet goes, the line stays
    return { text: text.slice(0, lineStart) + rest, caret: lineStart }
  }
  const ins = `\n${BULLET}`
  return { text: text.slice(0, caret) + ins + rest, caret: caret + ins.length }
}

const MARK = '=='

/** Highlight the words picked — or clear it, when they are highlighted already. Nothing picked: nothing changes. */
export function toggleHighlight(text: string, start: number, end: number): Edit {
  if (end <= start) return { text, start, end }
  // the picked words, without the spaces either side (a double-click picks a trailing space)
  let s = start, e = end
  while (s < e && /\s/.test(text[s])) s++
  while (e > s && /\s/.test(text[e - 1])) e--
  if (e <= s) return { text, start, end }
  const picked = text.slice(s, e)
  // picked with its marks, or inside them: clear
  if (picked.startsWith(MARK) && picked.endsWith(MARK) && picked.length > 4) {
    const inner = picked.slice(2, -2)
    return { text: text.slice(0, s) + inner + text.slice(e), start: s, end: s + inner.length }
  }
  if (text.slice(s - 2, s) === MARK && text.slice(e, e + 2) === MARK) {
    return { text: text.slice(0, s - 2) + picked + text.slice(e + 2), start: s - 2, end: s - 2 + picked.length }
  }
  // a highlight never runs across a line, so each line picked is marked on its own
  // …and a line's dot point stays outside its highlight
  const marked = picked.split('\n').map(l => {
    if (!l.trim()) return l
    const lead = l.startsWith(BULLET) ? BULLET : ''
    return `${lead}${MARK}${l.slice(lead.length).replaceAll(MARK, '')}${MARK}`
  }).join('\n')
  return { text: text.slice(0, s) + marked + text.slice(e), start: s, end: s + marked.length }
}

export type MarkRun = { text: string; mark: boolean }

/** The note's words split into highlighted and plain runs. */
export function markRuns(text: string | null | undefined): MarkRun[] {
  const s = String(text ?? '')
  const out: MarkRun[] = []
  let at = 0
  for (const m of s.matchAll(/==([^=\n]+?)==/g)) {
    const i = m.index ?? 0
    if (i > at) out.push({ text: s.slice(at, i), mark: false })
    out.push({ text: m[1], mark: true })
    at = i + m[0].length
  }
  if (at < s.length) out.push({ text: s.slice(at), mark: false })
  return out
}

/** the highlighter's colour on a note's colour — a yellow highlight vanishes on a yellow note */
export function highlightColour(noteColour: string | null | undefined): string {
  return noteColour === 'yellow' ? '#ffb86b' : '#fff066'
}
