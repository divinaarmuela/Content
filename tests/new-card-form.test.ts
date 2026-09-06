import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The New card / New shoot plan form, pinned from its source.
 *
 * The spec (docs/superpowers/specs/2026-09-06-three-pages-reset-design.md):
 * a card is ONE deliverable — one thing, one link, a free-text kind. The form
 * used to carry the old model: "Formats — add a row for each kind", a "How
 * many pieces?" count, and a shoot plan's list of "What is coming out of
 * this shoot?". The owner saw it and asked what the point of it was. These
 * tests make sure it does not come back, and that the requirement — "What
 * needs doing" — sits right under the title for every kind.
 */

const SRC = readFileSync(
  join(process.cwd(), 'app', 'dashboard', 'production', 'NewItemDialog.tsx'),
  'utf8',
)

describe('New card form — one thing, one box', () => {
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

  it('"What needs doing" is one box, right under the title, above kind and priority', () => {
    const title = SRC.indexOf('<Label>Title *</Label>')
    const box = SRC.indexOf('<Label>What needs doing</Label>')
    const priority = SRC.indexOf('<Label>Priority</Label>')
    const kind = SRC.indexOf('Kind of work')
    expect(title).toBeGreaterThan(-1)
    expect(box).toBeGreaterThan(title)
    expect(box).toBeLessThan(priority)
    expect(box).toBeLessThan(kind)
    // one label for every kind — not "Editing notes" / "Note to reviewer"
    expect(SRC.match(/What needs doing/g)).toHaveLength(1)
    expect(SRC).not.toMatch(/Editing notes/)
    expect(SRC).not.toMatch(/Note to reviewer/)
    // still stored as `brief`, still 3 rows
    expect(SRC).toMatch(/<Textarea rows=\{3\} value=\{draft\.brief\}/)
    expect(SRC).toMatch(/it goes to them/)
  })

  it('the first paint of "New shoot plan" is already the shoot-plan form', () => {
    // the kinds arrive by fetch, so anything derived only from the selected
    // kind is the regular form for a frame — the preset is known at render 1
    expect(SRC).toMatch(/const isBriefKind = presetKind === 'shoot_brief' \|\|/)
    expect(SRC).toMatch(/const hidesMedia = isBriefKind \|\| isTaskKind \|\|/)
  })
})

describe('Shoot page — a shoot with no plan lines', () => {
  const PAGE = readFileSync(
    join(process.cwd(), 'app', 'dashboard', 'production', 'shoots', '[id]', 'page.tsx'),
    'utf8',
  )

  it('shows no plan section at all — no heading over an empty list', () => {
    // the section is gated on having lines, and the old empty-state line is gone
    expect(PAGE).toMatch(/\{planned\.length > 0 && \(\s*<Card>/)
    expect(PAGE).not.toMatch(/Nothing listed yet/)
  })
})
