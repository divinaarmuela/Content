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

/** A leading bullet, dash, asterisk or "1." / "1)" numbering, with its space. */
const MARKER = /^\s*(?:[•·\-–—*]|\d{1,2}[.)])\s+/

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
