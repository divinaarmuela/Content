import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The New shoot plan form, pinned from its source.
 *
 * The spec (docs/superpowers/specs/2026-09-06-three-pages-reset-design.md):
 * a card is ONE deliverable — one thing, one link, a free-text kind — and a
 * shoot is one card. This file was once the dialog for everything (a regular
 * card, a task, a shoot plan) and carried the old model: "Formats — add a row
 * for each kind", a "How many pieces?" count, a "What is coming out of this
 * shoot?" list, a Files drop zone in two steps. Only the shoot plan was ever
 * opened from here, so that is all that is left. These tests make sure the
 * rest does not come back, and that the requirement — "What needs doing" —
 * sits right under the title.
 */

const SRC = readFileSync(
  join(process.cwd(), 'app', 'dashboard', 'production', 'NewItemDialog.tsx'),
  'utf8',
)

describe('New shoot plan form — one shoot, one card', () => {
  it('has no Formats rows and no quantity', () => {
    expect(SRC).not.toMatch(/Add another format/)
    expect(SRC).not.toMatch(/draft\.formats/)
    expect(SRC).not.toMatch(/How many pieces/)
    expect(SRC).not.toMatch(/draft\.count\b/)
    expect(SRC).not.toMatch(/numbered automatically/)
    expect(SRC).not.toMatch(/of \$\{regularTotal\}/)
  })

  it('does not ask a shoot plan for its lines, or require them', () => {
    expect(SRC).not.toMatch(/What is coming out of this shoot/)
    expect(SRC).not.toMatch(/draft\.deliverables/)
    expect(SRC).not.toMatch(/planned_deliverables/)
    expect(SRC).not.toMatch(/Say at least one thing/)
    expect(SRC).not.toMatch(/deliverable-group-core/)
  })

  it('sends one card with one kind — no group, no numbered copies', () => {
    expect(SRC).not.toMatch(/\/api\/production\/groups/)
    expect(SRC).not.toMatch(/Array\.from\(\{ length: count \}/)
    expect(SRC).not.toMatch(/group_id/)
    expect(SRC).toMatch(/const payload = \[\{/)
    // the one create request the form makes
    expect(SRC.match(/fetch\('\/api\/production\/items'/g)).toHaveLength(1)
  })

  it('"What this shoot is for" is one box, right under the title, above the shoot date', () => {
    const title = SRC.indexOf('<Label>Title *</Label>')
    const box = SRC.indexOf('<Label>What this shoot is for</Label>')
    const date = SRC.indexOf('<Label>Shoot date</Label>')
    expect(title).toBeGreaterThan(-1)
    expect(box).toBeGreaterThan(title)
    expect(box).toBeLessThan(date)
    // the SOP never asks for a priority, an existing-shoot picker or an outside plan link on a NEW shoot plan
    expect(SRC).not.toMatch(/<Label>Priority<\/Label>|A new shoot<\/SelectItem>|Outside plan link/)
    // one label — not "Editing notes" / "Note to reviewer"
    expect(SRC.match(/What this shoot is for/g)).toHaveLength(1)
    expect(SRC).not.toMatch(/Editing notes/)
    expect(SRC).not.toMatch(/Note to reviewer/)
    // still stored as `brief`, still 3 rows
    expect(SRC).toMatch(/<Textarea rows=\{3\} value=\{draft\.brief\}/)
    expect(SRC).toMatch(/written on the plan page/)
  })

  it('is only ever the shoot-plan form — no regular-card or task branch, no kind chooser', () => {
    expect(SRC).not.toMatch(/presetKind/)
    expect(SRC).not.toMatch(/isTaskKind|isBriefKind|hidesMedia/)
    expect(SRC).not.toMatch(/Kind of work/)
    expect(SRC).not.toMatch(/work-kinds\/suggest/)
    expect(SRC).not.toMatch(/New task|New card/)
    // the plan is always a plan: the shoot-plan kind, and the client's sign-off
    expect(SRC).toMatch(/work_kind_id: briefKind\.id/)
    expect(SRC).toMatch(/client_approval_required: true/)
  })

  it('has no files, no footage fields, no two-step phone form', () => {
    expect(SRC).not.toMatch(/No shoot — footage from elsewhere/)
    expect(SRC).not.toMatch(/Client must approve this/)
    expect(SRC).not.toMatch(/<Label>Files/)
    expect(SRC).not.toMatch(/Step \{step/)
    expect(SRC).not.toMatch(/raw_assets|uploadFiles|UploadRows|ExportWarnings|useIsMobile/)
    expect(SRC).not.toMatch(/Where is the footage from/)
  })

  it('says what it is: New shoot plan — one shoot, one card', () => {
    expect(SRC).toMatch(/<DialogTitle>New shoot plan <HelpHint term="shoot_plan" \/><\/DialogTitle>/)
    expect(SRC).toMatch(/One shoot, one plan\. .*\* required/)
    expect(SRC).toMatch(/Create the shoot plan/)
    // every control is 44px
    expect(SRC.match(/className="h-11 rounded-full/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
  })
})

describe('Shoot page — a shoot with no plan lines', () => {
  const PAGE = readFileSync(
    join(process.cwd(), 'app', 'dashboard', 'production', 'shoots', '[id]', 'page.tsx'),
    'utf8',
  )

  it('shows the plan section to anyone who can edit, lines or none — the checklist points at it', () => {
    // the owner, 11 Sep 2026: "where in the shoot page?" — a new shoot had
    // nowhere to type its deliverables. Drawn for editors of the plan, with
    // an empty-state line and the one-card rule under it.
    expect(PAGE).toMatch(/\{\(planned\.length > 0 \|\| canEdit\) && \(/)
    expect(PAGE).toMatch(/Nothing listed yet\. Add a line for each thing coming out of the shoot/)
    expect(PAGE).toMatch(/The editor gets one card for the whole shoot/)
  })
})
