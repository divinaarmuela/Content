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
    expect(src(EDITOR)).toMatch(/<CardSheet id=\{sheet\.cardId\} onClose=\{sheet\.close\} simple \/>/)
  })
  it('the plain drawer links to the full card page for renames and due dates', () => {
    // through itemPath, so an uploaded post never gets a link to the old
    // card page (tests/item-path-core pins that rule on the same file)
    expect(src(DRAWER)).toMatch(/href=\{itemPath\(item\)\}/)
    expect(src(DRAWER)).toMatch(/Full card/)
  })
})

describe('buttons the server would refuse are not drawn', () => {
  it('the board gives "Hand to…" only to people who may hand a card on', () => {
    const s = src(BOARD)
    expect(s).toMatch(/onHandTo=\{canEdit\(c\) && \(isManager \|\| viewer\.role === 'general'\) \? setHandToFor : undefined\}/)
  })
})
