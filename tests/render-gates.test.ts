import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * WHAT THE PAGE DRAWS, NOT WHAT IT COMPUTES.
 *
 * The render audit of 11 Sep 2026: every audit that day ran routes and pure
 * functions, and a new shoot still had nowhere to type its deliverables —
 * the section was drawn only when a line already existed, while the
 * checklist told people to add one "on the right". These pins read the
 * source of the pages, so a gate that hides a thing the words on screen
 * point at fails a test before it reaches a person.
 */

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const SHOOT = 'app/dashboard/production/shoots/[id]/page.tsx'
const SOP = 'app/dashboard/production/shoots/[id]/ShootSop.tsx'
const BOARD = 'app/dashboard/board/Board.tsx'
const SCHEDULER = 'app/dashboard/scheduler/page.tsx'
const EDITOR = 'app/dashboard/editor/page.tsx'
const DRAWER = 'app/dashboard/board/PostApprovalDetail.tsx'

describe('the shoot page draws what its checklist points at', () => {
  it('shows "What is coming out of this shoot" to anyone who can edit, lines or none', () => {
    const s = src(SHOOT)
    expect(s).toMatch(/\{\(planned\.length > 0 \|\| canEdit\) && \(/)
    expect(s).not.toMatch(/\{planned\.length > 0 && \(\s*<Card>/)
    // …and says what to do when it is empty
    expect(s).toMatch(/planned\.length === 0 && \(/)
    expect(s).toMatch(/Nothing listed yet\. Add a line for each thing coming out of the shoot/)
    // one shoot, one card (the owner, 11 Sep 2026)
    expect(s).toMatch(/The editor gets one card for the whole shoot/)
  })
  it('lets the same people edit the plan that the route lets in — the general role included', () => {
    const s = src(SHOOT)
    expect(s).toMatch(/const canEdit = \['editor', 'general', 'account_manager', 'super_admin'\]\.includes\(role\)/)
  })
  it('the Deliverables hint names the section on every screen size', () => {
    expect(src(SOP)).toMatch(/on the right, or below on a phone/)
  })
  it('the crew picker says what to do when nobody is left to add', () => {
    expect(src(SOP)).toMatch(/picks && addable\.length === 0 && \(/)
    expect(src(SOP)).toMatch(/added on the Team page/)
  })
  it('no words on the shoot page say booking happens anywhere but Go', () => {
    const s = src(SHOOT)
    expect(s).not.toMatch(/Book the shoot, and you can start creating items/)
    expect(s).not.toMatch(/review and books the date/)
  })
})

describe('one drawer for every card', () => {
  it('Post approval and Editor open the same plain drawer, so a shoot card is not shown the old one', () => {
    expect(src(SCHEDULER)).toMatch(/<CardSheet id=\{sheet\.cardId\} onClose=\{sheet\.close\} simple \/>/)
    expect(src(EDITOR)).toMatch(/<CardSheet id=\{sheet\.cardId\} onClose=\{sheet\.close\} simple editor=\{!isManager\} \/>/)
  })
  it('the plain drawer renames and sets the due date itself — no link out to the old card page', () => {
    expect(src(DRAWER)).toMatch(/Rename or set due date/)
    expect(src(DRAWER)).not.toMatch(/Full card/)
    expect(src(DRAWER)).not.toMatch(/itemPath\(/)
  })
})

describe('buttons the server would refuse are not drawn', () => {
  it('the board gives "Hand to…" only to people who may hand a card on', () => {
    const s = src(BOARD)
    expect(s).toMatch(/onHandTo=\{canEdit\(c\) && \(isManager \|\| viewer\.role === 'general'\) \? setHandToFor : undefined\}/)
  })
})

describe('the editor\u2019s card draws every SOP section, empty or not', () => {
  const EDITOR_DRAWER = 'app/dashboard/board/EditorCardDrawer.tsx'
  const CARD_SHEET = 'app/dashboard/board/CardSheet.tsx'
  it('the Editor page opens the editor\u2019s drawer for an editor, the manager\u2019s for a manager', () => {
    expect(src(EDITOR)).toMatch(/<CardSheet id=\{sheet\.cardId\} onClose=\{sheet\.close\} simple editor=\{!isManager\} \/>/)
    expect(src(CARD_SHEET)).toMatch(/editor && !adhoc\s*\? <EditorCardDrawer/)
  })
  it('the seven sections are not gated on having data', () => {
    const s = src(EDITOR_DRAWER)
    for (const id of ['ed-before', 'ed-from', 'ed-versions', 'ed-qc', 'ed-hand', 'ed-blocked', 'ed-history']) {
      expect(s, id).toContain(`aria-labelledby="${id}"`)
    }
    // no section is wrapped in a length/data gate
    expect(s).not.toMatch(/\{[a-zA-Z.]+\.length > 0 && \(\s*<section/)
    // the empty states say what to do
    expect(s).toMatch(/No final yet\. Export the finished cut/)
    expect(s).toMatch(/Not given yet — edit from the Dropbox working folder/)
    expect(s).toMatch(/Not blocked\./)
    expect(s).toMatch(/Once the card is approved: the final in the Drive monthly folder/)
    // "Before you start" says Not given rather than hiding a row
    expect(s).toMatch(/row\.value \?\? NOT_GIVEN/)
  })
  it('the editor\u2019s card carries nothing the SOP does not give an editor', () => {
    const s = src(EDITOR_DRAWER)
    for (const words of ['Hand to', 'Kind of work', 'Deliver only', 'Client portal', 'Rename or set due date']) {
      expect(s, words).not.toContain(words)
    }
  })
  it('submit is behind the seven checks and a file', () => {
    const s = src(EDITOR_DRAWER)
    expect(s).toMatch(/disabled=\{busy \|\| !qcComplete\(ticks\) \|\| slides\.length === 0\}/)
  })
})
