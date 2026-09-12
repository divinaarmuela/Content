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
    expect(s).toMatch(/disabled=\{busy \|\| !qcComplete\(ticks\) \|\| slides\.length === 0 \|\| !reviewLinkOk\}/)
    // the submit goes straight to the quality reviewer (Abby's rule), never to a manager's check
    expect(s).toMatch(/\{ to: 'quality_check' \}/)
    expect(s).not.toMatch(/to: 'internal_review'/)
  })
  it('after the seven ticks the card asks where the reviewer should look, and saves it with a PATCH', () => {
    const s = src(EDITOR_DRAWER)
    expect(s).toMatch(/\{qcComplete\(ticks\) && \(/)
    expect(s).toMatch(/id="ed-review-link"/)
    expect(s).toMatch(/id="ed-review-note"/)
    expect(s).toMatch(/Where should the reviewer look\?/)
    // the items route has no POST: the review fields go by PATCH (the live walk of 12 Sep 2026)
    expect(s).toMatch(/review_note: reviewNote\.trim\(\) \|\| null \}, 'Saved where to look', 'Saving', 'PATCH'\)/)
    // the reviewer sees it on the manager's card
    expect(src(DRAWER)).toMatch(/Look here:/)
    expect(src(DRAWER)).toMatch(/review_link/)
  })
  it('the card face for the maker opens the card ("Quality check, then submit"); the link controls are the manager’s', () => {
    const s = src('app/dashboard/board/BoardCard.tsx')
    expect(s).toMatch(/needsWorkFirst\(card\) \? UPLOAD_FIRST : 'Quality check, then submit'/)
    expect(s).toMatch(/adhoc_post === true \|\| editorFace \? null : canEdit \?/)
    expect(s).toMatch(/\{!settled && !adhocPost && !editorFace && \(/)
    // a red "at risk" chip has no place on a Done card (the live walk of 12 Sep 2026)
    expect(s).toMatch(/card\.status === 'scheduled' \|\| card\.status === 'published' \? null : riskChip/)
  })
  it('"Previous edits" opens the editor’s own page, and a second Acknowledge is a no-op', () => {
    expect(src('app/lib/editor-sop-core.ts')).toMatch(/href: `\/dashboard\/editor\?client=/)
    expect(src('app/api/production/items/[id]/flag/route.ts')).toMatch(/already: true/)
  })
})

/* ── the page inventory of 11 Sep 2026 (page-inventory-audit skill) ── */

describe('leftovers the SOP never asked for are gone', () => {
  const NEW_PLAN = 'app/dashboard/production/NewItemDialog.tsx'
  const DIALOGS = 'app/dashboard/board/BoardDialogs.tsx'
  const CARD = 'app/dashboard/board/BoardCard.tsx'

  it('New shoot plan asks only what the SOP asks: no priority, no existing-shoot picker, no outside link', () => {
    expect(src(NEW_PLAN)).not.toMatch(/<Label>Priority<\/Label>|A new shoot<\/SelectItem>|Outside plan link|milanote\.com/)
    expect(src(NEW_PLAN)).toMatch(/Account manager for this shoot/)
  })
  it('the shoot page has no link to the old Drive folder or the old card page, and no "Create items"', () => {
    expect(src(SHOOT)).not.toMatch(/Open Drive folder|Create items|new_for_shoot|dashboard\/production\/\$\{it\.id\}/)
    expect(src(SHOOT)).toMatch(/dashboard\/editor\?card=\$\{it\.id\}/)
    expect(src(SHOOT)).toMatch(/Plan canvas/)
    expect(src(SHOOT)).toMatch(/Notes for the team/)
  })
  it('the card link is the scheduler\u2019s Drive folder, in those words', () => {
    expect(src(CARD)).toMatch(/Drive folder to post from/)
    expect(src(CARD)).not.toMatch(/'Add a link'|'Replace the link'/)
    expect(src(DIALOGS)).toMatch(/Drive folder to post from/)
    expect(src(DIALOGS)).not.toMatch(/'Add the link'/)
  })
  it('the Editor\u2019s New card (simple) has no kind, deliverable or deliver-only picker', () => {
    const s = src(DIALOGS)
    expect(s).toMatch(/\{!simple && \(\s*<div className="flex flex-col gap-2">\s*<Label htmlFor="new-kind">Kind of work/)
    expect(s).toMatch(/\{!simple && groups\.length > 0 &&/)
    expect(s).toMatch(/\{isManager && !simple && \(/)
    expect(src(EDITOR)).toMatch(/<NewCardDialog[\s\S]*?simple\s*\/>/)
  })
})

describe('the shoot plan, every button (the walk of 12 Sep 2026)', () => {
  const REVIEW = 'app/dashboard/production/shoots/[id]/PlanReviewCard.tsx'
  const NEW_PLAN = 'app/dashboard/production/NewItemDialog.tsx'
  it('Go is the one sign-off: no second "Book the shoot" button or dialog on the shoot page', () => {
    const s = src(SHOOT)
    expect(s).not.toMatch(/Book this shoot\?|setLockOpen|lockOpen/)
    expect(s).not.toMatch(/transitions\.find\(t => t\.to === 'locked'\)/)
    // the plan's approval card points at Go, not at a Book button that is not there
    expect(src(REVIEW)).not.toMatch(/Book button above/)
    expect(src(REVIEW)).toMatch(/press Go, on the right/)
  })
  it('"Open the editor\u2019s card" opens it on Editor, never the old card page', () => {
    expect(src(SHOOT)).toMatch(/dashboard\/editor\?card=\$\{one\.id\}/)
    expect(src(SHOOT)).not.toMatch(/dashboard\/production\/\$\{one\.id\}/)
  })
  it('one shoot, one card — no "one line is one card" anywhere on the shoot page', () => {
    expect(src(SOP)).not.toMatch(/One line is one card/)
    expect(src(SOP)).toMatch(/The editor gets one card for the whole shoot/)
    expect(src(SOP)).toMatch(/The editor’s card is on the Editor page already/)
  })
  it('the sixth stage is "Footage in" on the board, the strip and the tutorials', () => {
    const core = src('app/lib/shoot-sop-core.ts')
    expect(core).toMatch(/label: 'Footage in'/)
    expect(core).not.toMatch(/label: 'Footage handed over'/)
    expect(src('app/lib/tutorial-core.ts')).not.toMatch(/Footage handed over/)
    expect(src('app/lib/getting-started-core.ts')).not.toMatch(/Footage handed over/)
  })
  it('New shoot plan\u2019s toast names Shoots, not a board that is gone', () => {
    expect(src(NEW_PLAN)).not.toMatch(/Production board/)
    expect(src(NEW_PLAN)).toMatch(/it is in Draft on Shoots/)
    expect(src(NEW_PLAN)).not.toMatch(/dashboard\/production\/\$\{first\.id\}/)
  })
})
