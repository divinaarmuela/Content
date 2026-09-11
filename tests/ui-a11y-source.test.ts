import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * TWO ACCESSIBILITY RULES, PINNED TO THE SOURCE OF THE TWO BUSIEST PAGES.
 *
 * The Schedule page and the Post approval page are where a scheduler, an
 * account manager and a super admin spend their day, and both are dense:
 * icon buttons on tiles, small print in the corners of cards. Two things go
 * wrong there again and again, and neither shows up in a render test because
 * the page still looks right:
 *
 *   1. A BUTTON WITH NOTHING IN IT BUT AN ICON AND NO `aria-label`. A screen
 *      reader reads it as "button", and nobody can tell the bin from the
 *      star. Every one of these files labels its icon buttons today; this
 *      keeps the next one honest.
 *
 *   2. A SENTENCE SET AT 10 OR 11 PIXELS. Short badge, eyebrow and axis
 *      labels can live at 11px; a paragraph cannot, and `<p>` is where the
 *      paragraphs are. The floor for body copy is 12px.
 *
 * It reads the files rather than rendering them on purpose: this is about
 * what the source CAN say, not what one particular state renders. Comments
 * are stripped first, so a docblock that explains the rule cannot break it.
 */

const FILES = [
  'app/dashboard/social/schedule/page.tsx',
  'app/dashboard/social/schedule/MediaRail.tsx',
  'app/dashboard/social/schedule/ProfilesBar.tsx',
  'app/dashboard/social/schedule/WeekGrid.tsx',
  'app/dashboard/social/schedule/views.tsx',
  'app/dashboard/social/schedule/tiles.tsx',
  'app/dashboard/social/schedule/NewPostDialog.tsx',
  'app/dashboard/social/schedule/CoverPicker.tsx',
  'app/dashboard/social/schedule/Tour.tsx',
  'app/dashboard/social/schedule/TimePicker.tsx',
  'app/dashboard/board/Board.tsx',
  'app/dashboard/board/BoardCard.tsx',
  'app/dashboard/board/PostApprovalDetail.tsx',
  'app/dashboard/board/BoardDialogs.tsx',
  'app/dashboard/board/EditorCardTools.tsx',
  'app/dashboard/board/EditorCardDrawer.tsx',
  'app/dashboard/board/BoardFilters.tsx',
  'app/dashboard/ui/NoReviewerBanner.tsx',
  'app/dashboard/board/FilesToWorkFrom.tsx',
  'app/dashboard/scheduler/page.tsx',
  'app/dashboard/scheduler/NewPostButton.tsx',
  'app/dashboard/scheduler/SendForApprovalDialog.tsx',
  'app/dashboard/production/ShootStageBoard.tsx',
  'app/dashboard/production/shoots/[id]/ShootSop.tsx',
  'app/dashboard/production/LaneBoard.tsx',
]

/** the file, with block and line comments taken out */
function source(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/**
 * Every `<button …>…</button>` in the file, as { attrs, inner }.
 *
 * The opening tag is WALKED rather than matched: half the buttons here carry
 * an `onClick={e => …}`, and a `>` inside a brace is not the end of the tag.
 * So the scan counts braces and skips quoted strings, and stops at the first
 * `>` outside both. Nothing in these files nests a button inside a button,
 * and one that did would be a bug of its own.
 */
function buttons(src: string): { attrs: string; inner: string; line: number }[] {
  const out: { attrs: string; inner: string; line: number }[] = []
  const TAG = '<button'
  for (let i = src.indexOf(TAG); i !== -1; i = src.indexOf(TAG, i + 1)) {
    if (/[A-Za-z0-9_]/.test(src[i + TAG.length] ?? '')) continue
    let depth = 0
    let quote = ''
    let j = i + TAG.length
    for (; j < src.length; j++) {
      const ch = src[j]
      if (quote) { if (ch === quote) quote = ''; continue }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue }
      if (ch === '{') depth++
      else if (ch === '}') depth--
      else if (ch === '>' && depth === 0) break
    }
    const attrs = src.slice(i + TAG.length, j)
    // a self-closing <button … /> has no children to be unlabelled
    if (attrs.trimEnd().endsWith('/')) continue
    const close = src.indexOf('</button>', j)
    if (close === -1) continue
    out.push({ attrs, inner: src.slice(j + 1, close), line: src.slice(0, i).split('\n').length })
  }
  return out
}

/**
 * IS THIS BUTTON NOTHING BUT AN ICON?
 *
 * True when its children are bare self-closing elements and nothing else —
 * `<Trash2 … />`, `<X … />` — with no words and no JSX expression that could
 * put words there. That is the exact shape the rule is about, and it is the
 * shape that reads as "button" and nothing more.
 *
 * A button whose children come through an expression (`{children}`, `{label}`,
 * `{open ? <A /> : <B />}`) is deliberately out of scope: the test cannot see
 * what the expression renders, and guessing would either nag about buttons
 * that are perfectly well labelled or quietly pass ones that are not. Those
 * are covered by reading the page, not by this floor.
 */
function iconOnly(inner: string): boolean {
  const body = inner.trim()
  if (body === '') return false
  return /^(?:<[A-Z][A-Za-z0-9]*(?:\s[^<>]*?)?\/>\s*)+$/.test(body)
}

describe('icon-only buttons carry a name', () => {
  for (const rel of FILES) {
    it(`${rel} labels every icon-only button`, () => {
      const offenders = buttons(source(rel))
        .filter(b => iconOnly(b.inner))
        .filter(b => !/\baria-label(?:ledby)?\s*=/.test(b.attrs))
        .map(b => `${rel}:${b.line}`)
      expect(offenders).toEqual([])
    })
  }
})

describe('body copy is never under 12px', () => {
  for (const rel of FILES) {
    it(`${rel} sets no <p> at 10px or 11px`, () => {
      const src = source(rel)
      const offenders: string[] = []
      const re = /<p\b([^>]*)>/g
      let m: RegExpExecArray | null
      while ((m = re.exec(src)) !== null) {
        if (/text-\[1[01]px\]/.test(m[1])) {
          offenders.push(`${rel}:${src.slice(0, m.index).split('\n').length}`)
        }
      }
      expect(offenders).toEqual([])
    })
  }
})
