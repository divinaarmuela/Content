import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { backspaceAtBullet, bulletBoxValue, bulletLines, bulletText, storedBullets } from '../app/lib/bullet-core'

/**
 * BULLET POINTS FROM A BOX OF TEXT (the owner, 15 Sep 2026: "make the script
 * and talking points bullet points — currently the box is just a box — and
 * show them properly on the PDF, the brief pages once sent to editors, and
 * their cards").
 */
describe('bulletLines / storedBullets', () => {
  it('one point per line, trimmed, blanks dropped', () => {
    expect(bulletLines('Hook first\n\n  Then the offer  \n')).toEqual(['Hook first', 'Then the offer'])
    expect(storedBullets('Hook first\n\n  Then the offer  \n')).toBe('Hook first\nThen the offer')
  })
  it('a marker somebody typed themselves is stripped once — never a double bullet', () => {
    expect(bulletLines('• one\n- two\n* three\n1. four\n2) five\n– six')).toEqual(['one', 'two', 'three', 'four', 'five', 'six'])
    // a marker with no space after it is not a marker — left as typed
    expect(bulletLines('••kept')).toEqual(['••kept'])
  })
  it('nothing in, nothing out', () => {
    expect(bulletLines(null)).toEqual([])
    expect(storedBullets('   \n  ')).toBe('')
    expect(bulletText('')).toBeNull()
  })
})

describe('bulletText — the points as they are drawn', () => {
  it('every line wears its bullet, for the card, the plan, the email and the PDF', () => {
    expect(bulletText('Hook first\nThen the offer')).toBe('• Hook first\n• Then the offer')
  })
  it('old free text becomes one point per line, not one long bullet', () => {
    expect(bulletText('Talk about spring.\nMention the sale.')).toBe('• Talk about spring.\n• Mention the sale.')
  })
})

describe('bulletBoxValue — what the typing box shows', () => {
  it('puts a bullet on every line, keeps the fresh empty last line for the cursor', () => {
    expect(bulletBoxValue('one\ntwo\n')).toBe('• one\n• two\n• ')
    expect(bulletBoxValue('• one\n• two')).toBe('• one\n• two')
  })
  it('an empty box stays empty — no lone bullet to delete before typing', () => {
    expect(bulletBoxValue('')).toBe('')
    expect(bulletBoxValue(null)).toBe('')
  })
})

describe('backspaceAtBullet — deleting a point (the owner, 15 Sep 2026: "when I delete a line the bullet does not get deleted too")', () => {
  it('a bullet whose words were deleted is stripped, never doubled', () => {
    expect(bulletBoxValue('• one\n•')).toBe('• one\n• ')
    expect(bulletLines('• one\n•')).toEqual(['one'])
  })
  it('Backspace on an empty point removes the line and lands on the end of the line above', () => {
    const t = '• one\n• '
    expect(backspaceAtBullet(t, t.length)).toEqual({ text: '• one', caret: 5 })
  })
  it('Backspace at a point’s bullet joins its words onto the line above', () => {
    const t = '• one\n• two\n• three'
    // caret right after "• " on the second line
    expect(backspaceAtBullet(t, 8)).toEqual({ text: '• onetwo\n• three', caret: 5 })
    // caret ON the bullet itself
    expect(backspaceAtBullet(t, 6)).toEqual({ text: '• onetwo\n• three', caret: 5 })
  })
  it('in the words, Backspace is just Backspace', () => {
    expect(backspaceAtBullet('• one\n• two', 9)).toBeNull()
  })
  it('the first point: empty goes, words stay', () => {
    expect(backspaceAtBullet('• \n• two', 2)).toEqual({ text: '• two', caret: 0 })
    expect(backspaceAtBullet('• one\n• two', 2)).toBeNull()
    expect(backspaceAtBullet('• ', 2)).toEqual({ text: '', caret: 0 })
  })
})

describe('where the points are drawn (source pins)', () => {
  const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
  it('the shoot page writes the script as bullets; the card, the plan text and the PDF draw them', () => {
    const sop = src('app/dashboard/production/shoots/[id]/ShootSop.tsx')
    // the one-box script is gone from the page (15 Sep 2026: "remove the script
    // and talking points"); the scripts editor is the row. An older plan's
    // one-box words still print as bullets on the card, the plan and the PDF.
    expect(sop).not.toContain('<BulletArea value={batch.script}')
    expect(sop).not.toContain("area('script'")
    expect(sop).toContain("<ScriptsEditor scripts={batch.scripts} onSave={v => void onPatch('scripts', v)} />")
    expect(src('app/lib/editor-sop-core.ts')).toContain("{ key: 'script', label: 'Script or talking points', value: bulletText(shoot?.script) }")
    expect(src('app/lib/shoot-sop-core.ts')).toContain('script: [bulletText(b.script), scriptsText(sanitiseScripts(b.scripts))].filter(Boolean).join(\'\\n\\n\')')
    expect(src('app/lib/brief-pdf.ts')).toContain("push('SCRIPT OR TALKING POINTS', bulletText(d.script) ?? '')")
  })
  it('the box: Enter starts the next point, blur saves the plain lines', () => {
    const box = src('app/dashboard/production/shoots/[id]/BulletArea.tsx')
    expect(box).toContain("if (e.key === 'Enter' && !e.shiftKey) {")
    // Backspace on a bullet deletes the point; the caret follows the words
    expect(box).toContain("if (e.key === 'Backspace' && el.selectionStart === el.selectionEnd) {")
    expect(box).toContain('const gone = backspaceAtBullet(text, el.selectionStart ?? 0)')
    expect(box).toContain('if (next !== raw) place(el, Math.max(0, Math.min(next.length, at + (next.length - raw.length))))')
    expect(box).toContain('const stored = storedBullets(text)')
    expect(box).toContain('if (stored !== storedBullets(value)) onSave(stored)')
  })
})

describe('client availability is gone from the shoot page (the owner, 15 Sep 2026)', () => {
  const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
  it('no row on the page, no part in the checklist, no section on the PDF; the tick is about the location', () => {
    const sop = src('app/dashboard/production/shoots/[id]/ShootSop.tsx')
    expect(sop).not.toContain("row('client_availability'")
    expect(sop).toContain('<span>Location confirmed{')
    expect(sop).not.toContain('Client availability and location confirmed')
    expect(src('app/lib/shoot-sop-core.ts')).not.toContain("{ key: 'client_availability'")
    expect(src('app/lib/brief-pdf.ts')).not.toContain("push('CLIENT AVAILABILITY'")
  })
})
