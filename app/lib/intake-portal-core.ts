/**
 * Pure logic for showing intake answers on the client portal — no imports of
 * I/O, fully unit-testable. Owns two decisions:
 *   1. WHICH of a client's intake forms are shown on their portal, and in what
 *      order (the toggle gate), and
 *   2. the read-only view model of one form's answers (every question + answer,
 *      unanswered flagged) that the portal renders.
 *
 * The server layer (portal-data.ts) reads the database and hands rows here;
 * nothing here touches Supabase, so the rules can be tested in isolation and
 * the portal never depends on the shape of a query.
 */

import type { Answers, TemplateDefinition } from './intake-core'

/** One answered question in the read-only view. `answered` false = the client
 *  left it blank; the portal greys it and prints "Not answered". */
export type IntakeAnswerRow = {
  id: string
  label: string
  /** the answer as one string — arrays (multi-select, files) are joined */
  text: string
  answered: boolean
}

/** One section of a form in the read-only view. Sections whose only blocks are
 *  guidance copy are dropped upstream, so every section here has ≥1 row. */
export type IntakeAnswerSection = {
  id: string
  title: string
  rows: IntakeAnswerRow[]
}

/** A form as the portal shows it: a title and its answers, nothing else. No
 *  token, no status, no recipients — the portal is client-facing and read-only. */
export type PortalIntakeForm = {
  id: string
  title: string
  sections: IntakeAnswerSection[]
  /** total answered / total answerable, for the small count next to the title */
  answered: number
  total: number
}

/** The database row shape this module consumes. Every field the toggle logic
 *  reads is optional so a row from a database WITHOUT the show_on_portal column
 *  (before the migration runs) still types — it simply reads as not-shown. */
export type IntakeFormRow = {
  id: string
  title?: string | null
  show_on_portal?: boolean | null
  submitted_at?: string | null
  created_at?: string | null
  definition: TemplateDefinition
  answers?: Answers | null
}

function isAnswered(value: string | string[] | undefined): boolean {
  if (Array.isArray(value)) return value.length > 0
  return typeof value === 'string' && value.trim() !== ''
}

/**
 * The read-only view model of one form's answers.
 *
 * Every answerable question is included, answered or not — the gaps are as much
 * a part of the picture as the answers, and hiding them would hide the most
 * useful thing. Guidance blocks (the italic "why we're asking" copy) hold no
 * value and are dropped; a section left with no answerable blocks is dropped
 * whole so the portal never prints an empty heading.
 */
export function intakeAnswerView(
  definition: TemplateDefinition,
  answers: Answers,
): IntakeAnswerSection[] {
  const out: IntakeAnswerSection[] = []
  for (const section of definition.sections ?? []) {
    const rows: IntakeAnswerRow[] = []
    for (const b of section.blocks ?? []) {
      if (b.type === 'guidance') continue
      const v = answers[b.id]
      const text = Array.isArray(v) ? v.join(', ') : (v ?? '')
      rows.push({ id: b.id, label: b.label, text, answered: isAnswered(v) })
    }
    if (rows.length > 0) out.push({ id: section.id, title: section.title, rows })
  }
  return out
}

/** Answered / answerable counts for a built view (guidance already excluded). */
function countAnswers(sections: IntakeAnswerSection[]): { answered: number; total: number } {
  let answered = 0
  let total = 0
  for (const s of sections) {
    for (const r of s.rows) {
      total += 1
      if (r.answered) answered += 1
    }
  }
  return { answered, total }
}

/** Newest first: the form the client last submitted is the one they most likely
 *  want to see. Falls back to created_at, then leaves order untouched. */
function newestFirst(a: IntakeFormRow, b: IntakeFormRow): number {
  const at = a.submitted_at ?? a.created_at ?? ''
  const bt = b.submitted_at ?? b.created_at ?? ''
  if (at === bt) return 0
  return at < bt ? 1 : -1
}

/**
 * The intake forms to show on a client's portal, as ready-to-render view
 * models, most recent first.
 *
 * The gate is the toggle and nothing else: a form is shown iff show_on_portal
 * is exactly true. A row from a database without the column (the value comes
 * back undefined) reads as not-shown, which is why the whole feature degrades
 * to "no tab" before the migration runs. An empty result means the portal shows
 * no tab at all and is byte-for-byte what it is today.
 */
export function portalIntakeForms(rows: IntakeFormRow[]): PortalIntakeForm[] {
  return (rows ?? [])
    .filter(r => r.show_on_portal === true)
    .slice()
    .sort(newestFirst)
    .map(r => {
      const sections = intakeAnswerView(r.definition, (r.answers ?? {}) as Answers)
      const { answered, total } = countAnswers(sections)
      return {
        id: r.id,
        title: (r.title ?? '').trim() || 'Intake form',
        sections,
        answered,
        total,
      }
    })
}
