/**
 * BULLET POINTS FROM A BOX OF TEXT (the owner, 15 Sep 2026: "in the shoot
 * brief page, make the script and talking points bullet points — currently
 * the box is just a box — and show them properly on the PDF, the brief pages
 * once sent to editors, and their cards").
 *
 * The words are STORED as plain lines, one point per line, no marker — the
 * way they always were, so nothing already written changes shape. The bullet
 * is put on when the words are DRAWN: the box on the shoot page, the row on
 * the editor's card, the read-only plan, the email, the PDF. A line somebody
 * typed with its own "-", "•", "*" or "1." in front loses that marker once,
 * so a list is never double-bulleted.
 */
export const BULLET = '•'

/** A leading bullet, dash, asterisk or "1." / "1)" numbering, with the space
 *  after it — or with nothing after it, which is a bullet whose words have
 *  just been deleted (the owner, 15 Sep 2026: "when I delete a line the
 *  bullet does not get deleted too"). */
const MARKER = /^\s*(?:[•·\-–—*]|\d{1,2}[.)])(?:\s+|$)/

/** The points in the text: one per line, trimmed, markers stripped, blanks dropped. */
export function bulletLines(text: string | null | undefined): string[] {
  return String(text ?? '')
    .split(/\r?\n/)
    .map(l => l.replace(MARKER, '').trim())
    .filter(Boolean)
}

/** The points as they are stored: plain lines, one per point. Empty for none. */
export function storedBullets(text: string | null | undefined): string {
  return bulletLines(text).join('\n')
}

/** The points as they are drawn: "• one\n• two". Null when there are none —
 *  a row with nothing in it says "Not given", not an empty bullet. */
export function bulletText(text: string | null | undefined): string | null {
  const lines = bulletLines(text)
  return lines.length > 0 ? lines.map(l => `${BULLET} ${l}`).join('\n') : null
}

/**
 * What the typing box shows: every line wearing its bullet, and a bullet
 * waiting on the last line when the person has just pressed Enter (an empty
 * last line is kept, so the cursor lands on a fresh point).
 */
export function bulletBoxValue(typed: string | null | undefined): string {
  const raw = String(typed ?? '')
  if (raw.trim() === '') return ''
  const lines = raw.split(/\r?\n/)
  return lines
    .map((l, i) => {
      const bare = l.replace(MARKER, '').trimStart()
      if (bare === '' && i < lines.length - 1) return ''      // a blank line in the middle is nothing
      return `${BULLET} ${bare}`
    })
    .join('\n')
}

/**
 * BACKSPACE ON A BULLET DELETES THE POINT (the owner, 15 Sep 2026: "when I
 * delete a line the bullet does not get deleted too — this is bad user
 * experience"). The box redraws bullets on every keystroke, so Backspace
 * could empty a point's words but never take the bullet itself away. With
 * the caret at or inside a line's bullet ("• |words"), Backspace now removes
 * the line: its words join the end of the line above, the way any editor
 * merges lines. On the first line there is nothing above — an empty first
 * point goes, a first point with words stays.
 *
 * Pure: hands back the new text and where the caret goes, or null when the
 * keystroke should behave normally.
 */
export function backspaceAtBullet(text: string, caret: number): { text: string; caret: number } | null {
  const lineStart = text.lastIndexOf('\n', caret - 1) + 1
  const line = text.slice(lineStart)
  const marker = MARKER.exec(line)?.[0] ?? ''
  // only when the caret sits at, or inside, the bullet — never in the words
  if (!marker || caret - lineStart > marker.length) return null
  const lineEnd = text.indexOf('\n', lineStart)
  const end = lineEnd === -1 ? text.length : lineEnd
  const words = text.slice(lineStart + marker.length, end)
  const rest = text.slice(end)                                 // "\n…" or ""
  if (lineStart === 0) {
    if (words.trim() !== '') return null                        // the first point keeps its words
    return { text: rest.replace(/^\n/, ''), caret: 0 }
  }
  const above = text.slice(0, lineStart - 1)                   // without the newline before this line
  return { text: above + words + rest, caret: above.length }
}
