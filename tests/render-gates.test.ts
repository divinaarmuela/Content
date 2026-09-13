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

describe('the shoot page, rebuilt from the Shoot Brief SOP (13 Sep 2026)', () => {
  const page = src(SHOOT)
  const sop = src(SOP)
  it('draws the SOP’s sections and nothing else', () => {
    for (const heading of ['The shoot plan', 'Notes for the team', 'Plan canvas', 'Where it is', 'Who is on this shoot', 'The editor’s card', 'Client portal', 'What happened']) {
      expect(page + sop).toContain(heading)
    }
    // the plan-document approval is gone from the page: no review card, no
    // "Write the shoot plan", no second set of buttons, no old lifecycle
    expect(page).not.toMatch(/PlanReviewCard|Write the shoot plan|Send plan for review|What’s the next move|Book the shoot|availableBatchTransitions|SHOWN_SHOOT_LABEL|shoot_brief.*work_kind/)
    expect(page + sop).not.toMatch(/Open Drive folder|Create items|new_for_shoot|dashboard\/production\/\$\{it\.id\}|Full card/)
  })
  it('every field of the nine parts is inside its row — deliverables, the shot list, the date, call time and location', () => {
    expect(sop).toMatch(/row\('deliverables', \(/)
    expect(sop).toMatch(/row\('shot_list', \(/)
    expect(sop).toMatch(/row\('when_where', \([\s\S]*?Shoot date[\s\S]*?Call time[\s\S]*?Location/)
    expect(sop).toMatch(/Add shot/)
    expect(sop).not.toMatch(/on the right, or below on a phone|both are under Shoot details/)
    expect(page).not.toMatch(/Shoot details|What is coming out of this shoot/)
  })
  it('nothing on the page is greyed by role — the server refuses everyone but the managers, who may do everything', () => {
    expect(page).not.toMatch(/const canEdit|const isManager|disabled=\{!canEdit\}/)
    expect(sop).not.toMatch(/disabled=\{!canEdit\}|picksTeam|isManager\(/)
    expect(page).toMatch(/json\.redirect/)
    expect(src('app/lib/shoot-sop-core.ts')).toMatch(/export function canManageShoot/)
  })
  it('Where it is: one next button with its reason, the two ticks with who ticked them, the client share, the footage folder, and every stamp with who and when', () => {
    expect(sop).toMatch(/const next: \{ to: ShootStage; label: string \} \| null =/)
    expect(sop).toMatch(/\{!check\.ok && <p className="text-\[12px\] text-muted-foreground" role="status">\{check\.reason\}<\/p>\}/)
    expect(sop).toMatch(/Share the plan with the client/)
    expect(sop).toMatch(/stampLines\(batch, nameOf\)/)
    expect(sop).toMatch(/nameOf\(batch\.aligned_by\)/)
    expect(sop).toMatch(/Footage folder/)
    expect(sop).not.toMatch(/mayPasteFolder/)
  })
  it('the editor’s card and the people: one line and "Open on Editor"; the crew read the plan on their card or from their email', () => {
    expect(sop).toMatch(/dashboard\/editor\?card=\$\{one\.id\}/)
    expect(sop).toMatch(/Open on Editor/)
    expect(sop).toMatch(/The editor presses “I’ve read the plan” on their card; the crew press the link in their email/)
    expect(sop).not.toMatch(/onAck|I’ve read the plan<\/Button>/)
  })
  it('the header says who created the shoot and when', () => {
    expect(page).toMatch(/createdWords\(batch, nameOf\)/)
  })
  it('the editor’s card carries "I’ve read the plan", and the Shoots board card says who created it and how many have read it', () => {
    const drawer = src('app/dashboard/board/EditorCardDrawer.tsx')
    expect(drawer).toMatch(/I’ve read the plan/)
    expect(drawer).toMatch(/\/api\/production\/batches\/\$\{shoot\.id\}\/acknowledge/)
    const board = src('app/dashboard/production/ShootStageBoard.tsx')
    expect(board).toMatch(/Created by \$\{creator\}/)
    expect(board).toMatch(/read \$\{ack\.done\} of \$\{ack\.total\}/)
    expect(board).not.toMatch(/BRIEF_KIND_LABELS|planTone/)
    expect(board).toMatch(/dashboard\/editor\?card=\$\{shootCardId\(s\.id\)\}/)
  })
  it('the Editor page’s New card lets a manager type a shoot that was never planned here', () => {
    const dialogs = src('app/dashboard/board/BoardDialogs.tsx')
    expect(dialogs).toMatch(/Another shoot — type its name/)
    expect(dialogs).toMatch(/footage_only: true/)
    expect(dialogs).toMatch(/\{\(shoots\.length > 0 \|\| simple\) && \(/)
    expect(src('app/dashboard/production/ShootStageBoard.tsx')).toMatch(/FOOTAGE_ONLY_WORDS/)
  })
  it('New shoot plan makes the shoot itself — no plan document', () => {
    const dialog = src('app/dashboard/production/NewItemDialog.tsx')
    expect(dialog).toMatch(/fetch\('\/api\/production\/batches'/)
    expect(dialog).not.toMatch(/work_kind_id|shoot_brief|client_approval_required/)
  })
})

describe('one drawer for every card', () => {
  it('Post approval and Editor open the same plain drawer, so a shoot card is not shown the old one', () => {
    expect(src(SCHEDULER)).toMatch(/<CardSheet id=\{sheet\.cardId\} onClose=\{sheet\.close\} simple \/>/)
    expect(src(EDITOR)).toMatch(/<CardSheet id=\{sheet\.cardId\} onClose=\{sheet\.close\} simple editor \/>/)
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
    expect(src(EDITOR)).toMatch(/<CardSheet id=\{sheet\.cardId\} onClose=\{sheet\.close\} simple editor \/>/)
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
    expect(s).toMatch(/No final yet\. Add the finished cut here/)
    expect(s).toMatch(/Not given yet — ask Production\./)
    expect(s).toMatch(/Not blocked\./)
    expect(s).toMatch(/Shown once the card is approved\./)
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
    expect(s).toMatch(/Review link/)
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
    expect(src(SHOOT) + src(SOP)).not.toMatch(/Open Drive folder|Create items|new_for_shoot|dashboard\/production\/\$\{it\.id\}/)
    expect(src(SOP)).toMatch(/dashboard\/editor\?card=\$\{one\.id\}/)
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
  const NEW_PLAN = 'app/dashboard/production/NewItemDialog.tsx'
  it('Go is the one sign-off: no second "Book the shoot" button or dialog on the shoot page', () => {
    const s = src(SHOOT)
    expect(s).not.toMatch(/Book this shoot\?|setLockOpen|lockOpen/)
    expect(s).not.toMatch(/transitions\.find\(t => t\.to === 'locked'\)/)
  })
  it('one shoot, one card — no "one line is one card" anywhere on the shoot page', () => {
    expect(src(SOP)).not.toMatch(/One line is one card/)
    expect(src(SOP)).toMatch(/The editor gets one card for the whole shoot/)
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
