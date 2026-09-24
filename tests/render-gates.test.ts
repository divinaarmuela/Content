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
    for (const heading of ['The shoot plan', 'Notes for the team', 'Plan canvas', 'Where it is', 'Who is on this shoot', 'The editor’s card', 'What happened']) {
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
    // THE CLIENT IN ONE PLACE (13 Sep 2026): one button puts the plan on the
    // portal; the links and "take it off" appear there once it is on; no
    // second Client portal card, no switch
    expect(sop).toMatch(/Put the plan on the client portal/)
    expect(sop).toMatch(/Take it off the portal/)
    expect(sop).not.toMatch(/Share the plan with the client|Visible on the client portal|<Switch/)
    expect(page).not.toMatch(/<PortalPanel/)
    expect(sop).toMatch(/stampLines\(batch, nameOf, \{ planReview: gate \}\)/)
    expect(sop).toMatch(/nameOf\(batch\.aligned_by\)/)
    expect(sop).toMatch(/Footage folder/)
    expect(sop).not.toMatch(/mayPasteFolder/)
    // THE LINK IS CONFIRMED BEFORE IT IS USED, and a wrong one is replaced (16 Sep 2026)
    expect(sop).not.toContain("onBlur={() => { const v = folder.trim(); if (v !== (batch.footage_url ?? '')) void onPatch('footage_url', v || null) }}")
    expect(sop).toContain("const folderChanged = folder.trim() !== (batch.footage_url ?? '')")
    expect(sop).toContain("{!folder.trim() ? 'Take the folder off' : batch.footage_url ? 'Replace the footage folder' : 'Use this footage folder'}")
    expect(sop).toContain("const ok = await onPatch('footage_url', folder.trim() || null)")
    expect(sop).toContain("{savingFolder ? 'Saving…' : !folder.trim() ? 'Yes, take it off' : 'Yes, use this link'}")
    expect(sop).toContain('Anyone with the link')
    // nobody on the card, said plainly, with where to put somebody on it
    expect(sop).toContain('The card is made — nobody is on it yet')
    expect(sop).toContain('Pick the editor under Who is on this shoot, or open the card and press Assign an editor.')
  })
  it('the editor’s card and the people: one line and "Open on Editor"; the crew read the plan on their card or from their email', () => {
    expect(sop).toMatch(/dashboard\/editor\?card=\$\{one\.id\}/)
    expect(sop).toMatch(/Open on Editor/)
    expect(sop).toMatch(/The editor presses “I’ve read the plan” on their card; the crew press the link in their email/)
    // …and the viewer's OWN row carries "I've read the plan" when they are on the
    // shoot — a super admin or AM on set acknowledges here (14 Sep 2026)
    expect(sop).toMatch(/c\.id === viewerId && onAck/)
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
  it('a card NEVER makes a shoot (the owner, 13 Sep 2026: it should not do that, at all)', () => {
    const dialogs = src('app/dashboard/board/BoardDialogs.tsx')
    expect(dialogs).not.toMatch(/footage_only|\/api\/production\/batches'/)
    // …but the shoot's NAME can be typed onto the card (14 Sep 2026)
    expect(dialogs).toMatch(/Another shoot — I’ll type its name/)
    expect(dialogs).toMatch(/From the shoot: \$\{shootText\.trim\(\)\}/)
    expect(dialogs).toMatch(/\{\(shoots\.length > 0 \|\| simple\) && !forPosting && \(/)
    // and the server takes no such flag either
    expect(src('app/api/production/batches/route.ts')).not.toMatch(/footageOnlyPatch|body\.footage_only/)
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
    // the Editor page opens the card's own PAGE (15 Sep 2026: "not a slider
    // anymore"), which chooses the same three cards the sheet did
    expect(src(EDITOR)).toContain('onOpen={c => router.push(`/dashboard/editor/${c.id}`)}')
    expect(src(EDITOR)).not.toContain('<CardSheet')
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
    // …on the card's own page (15 Sep 2026)
    const page = src('app/dashboard/editor/[id]/page.tsx')
    expect(page).toContain('const maker = usesMakerDrawer(me, item)')
    // …and a manager gets the same brief, with their buttons above it (15 Sep 2026)
    expect(page).toContain('<EditorCardDrawer key={id} id={id} onClose={back} hideFolderFiles />')
    expect(page).toContain('<ManagerActions item={item} client={client ?? null} viewer=')
    // the top bar's box asks the assistant (the AI search, 16 Sep 2026)
    const shell = src('app/dashboard/ui/Shell.tsx')
    expect(shell).not.toContain('Search — coming soon')
    expect(shell).toContain('router.push(`/dashboard/ai?q=${encodeURIComponent(t)}`)')
    expect(src('app/dashboard/ai/Assistant.tsx')).toContain("q = url.searchParams.get('q') ?? ''")
    expect(src('app/api/assistant/route.ts')).toContain('go to search_cards')
    // columns or a list, remembered per page (16 Sep 2026)
    const board = src('app/dashboard/board/Board.tsx')
    expect(board).toContain("const [view, setView] = usePersistedChoice(`board-view.${page}`, BOARD_VIEWS, 'columns', 'view')")
    expect(board).toContain("{view === 'list' ? (")
    const list = src('app/dashboard/board/BoardList.tsx')
    expect(list).toContain('cardLines(card, { names, today, viewerId: viewer.id })')
    expect(list).toContain("{handedIn ? 'Finished edit in' : lines.link ? 'Folder only' : 'Nothing yet'}")
    // the Editor page's card is just the title until Details is pressed (17 Sep 2026)
    expect(src('app/dashboard/board/BoardCard.tsx')).toContain("const [folded, setFolded] = useState(page === 'editor')")
    expect(src('app/dashboard/board/BoardCard.tsx')).toContain('note={folded ? null : (<>')
    expect(src('app/dashboard/board/BoardCard.tsx')).toContain("{folded ? 'Details' : 'Less'}")
    // the board card's brief folds to two lines and opens smoothly — never `block` beside `line-clamp-2` (16 Sep 2026)
    const boardCard = src('app/dashboard/board/BoardCard.tsx')
    expect(boardCard).not.toContain("mb-1 block whitespace-pre-line text-foreground [[data-tone=ink]_&]:text-cream ${briefOpen ? '' : 'line-clamp-2'}")
    expect(boardCard).toContain("${briefOpen ? 'block max-h-[200rem]' : 'max-h-[3em]'} ${briefClamped && !briefOpen ? 'line-clamp-2' : briefOpen ? '' : 'block'}")
    expect(boardCard).toContain('transition-[max-height] duration-500 ease-in-out')
    // comments on a clip are one line per clip with the link, never piled into the card's thread (16 Sep 2026)
    expect(src(EDITOR_DRAWER)).toContain('const cardThread = useMemo(() => withoutRepeatedNotes(thread as { body?: string | null; video_file_id?: string | null }[]).filter(c => !c.video_file_id) as typeof thread, [thread])')
    expect(src(EDITOR_DRAWER)).toContain('<Link href={reviewPath(item.id, t.id, t.name)}')
    expect(src(EDITOR_DRAWER)).toContain('rows={cardThread as never}')
    // the holder or a manager can change the card's name, due date and brief (16 Sep 2026)
    expect(src(EDITOR_DRAWER)).toContain('{(holder || isManager) && !frozen && !editing && (')
    expect(src(EDITOR_DRAWER)).toContain("{ title, due_date: eDue || null, brief: eBrief.trim() || null, priority: ePriority }, 'Card updated', 'Saving the card', 'PATCH')")
    // …and everyone but an editor — the quality checker, the managers — gets
    // the manager's drawer there (13 and 14 Sep 2026)
    expect(src(CARD_SHEET)).toMatch(/editor && !adhoc && maker\s*\? <EditorCardDrawer/)
  })
  it('the seven sections are not gated on having data', () => {
    const s = src(EDITOR_DRAWER)
    // (no 'ed-blocked': the owner had the I'm blocked feature removed, 17 Sep 2026)
    for (const id of ['ed-before', 'ed-from', 'ed-versions', 'ed-qc', 'ed-hand', 'ed-history']) {
      expect(s, id).toContain(`aria-labelledby="${id}"`)
    }
    // no section is wrapped in a length/data gate
    expect(s).not.toMatch(/\{[a-zA-Z.]+\.length > 0 && \(\s*<section/)
    // the empty states say what to do
    // "Your finished edit": a Drive/Dropbox link or files, nothing else (14 Sep 2026)
    expect(s).toMatch(/Your finished edit/)
    expect(s).toMatch(/Nothing handed in yet\./)
    expect(s).toMatch(/Not given yet — ask Production\./)
    // Handover and Blocked? are the two that DO step aside when they have
    // nothing to say (the owner, 13 Sep 2026: "your UI has so many texts in
    // the card") — no "Not blocked." / "Shown once approved." filler
    expect(s).not.toMatch(/Not blocked\./)
    expect(s).not.toMatch(/Shown once the card is approved\./)
    expect(s).toMatch(/\{showsHandover\(status\) && \(/)
    expect(s).not.toMatch(/I’m blocked/)
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
    // the link is the work: no files gate the submit (14 Sep 2026)
    expect(s).toMatch(/disabled=\{busy \|\| !qcComplete\(ticks\) \|\| !hasFinishedWork\(item as never\)\}/)
    expect(s).not.toMatch(/asset_versions|slidesOf|<Thumb /)
    // the submit goes straight to the quality reviewer (Abby's rule), never to a manager's check
    expect(s).toMatch(/\{ to: 'quality_check' \}/)
    expect(s).not.toMatch(/to: 'internal_review'/)
  })
  it('the editor’s card is a link, the checks and a submit — no review link, no Drive picker, no upload (14 Sep 2026)', () => {
    const s = src(EDITOR_DRAWER)
    expect(s).not.toMatch(/Review link|ed-review-link|Pick the final from Google Drive|Source files \(Dropbox\)/)
    // the owner: "why is there an add files feature in the editor card — it's just supposed to be a link"
    // …and a DESIGNER's card hands in files (17 Sep 2026): the upload sits behind the graphics kind, never on an editor's card
    expect(s).not.toMatch(/Or upload files/)
    // …and on 22 Sep 2026 the owner reversed the link-only card: "when uploading version 1, a popup — upload the
    // file instead of a Drive link". The link is now the fallback for a file over 5GB, behind linkMode.
    // a link card may hand in files too since 24 Sep 2026 — the files half is no longer hidden from it
    expect(s).toContain('{(filesCard || fileMode) && !linkMode ? (')
    expect(s).toContain('<Dialog open={uploadOpen}')
    expect(s).toContain("const { row: kind, loading: kindLoading } = useRow<WorkKind>('work_kinds', item?.work_kind_id ?? null)")
    expect(s).toContain('const filesCard = item ? handsInFiles({ ...item, work_kinds: (item as { work_kinds?: { slug?: string } | null }).work_kinds ?? kind } as never) : false')
    expect(s).toContain("'Add the link to your finished edit first'")
  })
  it('the card face for the maker opens the card ("Quality check, then submit"); the link controls are the manager’s', () => {
    const s = src('app/dashboard/board/BoardCard.tsx')
    expect(s).toMatch(/needsWorkFirst\(card\) \? UPLOAD_FIRST : 'Quality check, then submit'/)
    expect(s).toMatch(/adhoc_post === true \|\| editorFace \? null : canEdit \?/)
    expect(s).toMatch(/\{!settled && !adhocPost && !editorFace && !schedulerFace && \(/)
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
    // the client is TYPED, not dropped down; the AM picker's closed face is
    // the name only, so nothing pushes the window wide (13 Sep 2026)
    expect(src(NEW_PLAN)).toMatch(/<ClientTypeahead/)
    expect(src(NEW_PLAN)).not.toMatch(/placeholder="Choose client"/)
    expect(src(NEW_PLAN)).toMatch(/\[&>\*\]:min-w-0/)
    expect(src('app/dashboard/production/ClientTypeahead.tsx')).toMatch(/role="combobox"/)
  })
  it('the quality review gate on a plan: the row, the reviewer’s two answers, the board chip (13 Sep 2026)', () => {
    const s = src(SOP)
    expect(s).toMatch(/data-plan-review/)
    expect(s).toContain('Pass the plan')
    expect(s).toContain('Send back with a note')
    // no review row at all on a plan that does not need the gate (a super
    // admin's own plan): the picker and the button sit inside `gate &&`
    // ONE STATE AT A TIME (13 Sep 2026): not sent → one button; with the
    // checker → the reviewer's two answers only; passed → nothing to press
    expect(s).toMatch(/data-review-state="not-sent"/)
    expect(s).toMatch(/\{!asked && !passed && onAskReview && \(/)
    expect(s).toContain('Send the plan for quality review')
    expect(s).toContain('or pick a person')
    expect(s).toMatch(/\{asked && \(\s*<div className="flex flex-col gap-2 pl-8" data-review-state="asked">\s*\{viewerIsReviewer && onPlanReview && \(/)
    expect(s).toMatch(/\{passed && onPlanReview && role === 'super_admin' && \(/)
    expect(s).toContain('Quality review — not sent yet')
    expect(s).not.toContain('Ask for a review again')
    expect(s).not.toContain('REVIEW_DEFAULT_MANAGERS')
    expect(s).toMatch(/planReview: input\.planReview|planReview \}/)
    const board = src('app/dashboard/production/ShootStageBoard.tsx')
    const core = src('app/lib/shoot-sop-core.ts')
    expect(board).toMatch(/planReviewChip\(s, gated\(s\)\)/)
    // the column: the board groups by the gated stage, the lane has its empty line
    expect(board).toMatch(/shootStage\(s, today, \{ planReview: gated\(s\) \}\)/)
    expect(core).toContain("label: 'Quality review'")
    expect(core).toContain("empty: 'Nothing waiting on the quality checker.'")
  })
  it('the shoot page has no link to the old Drive folder or the old card page, and no "Create items"', () => {
    expect(src(SHOOT) + src(SOP)).not.toMatch(/Open Drive folder|Create items|new_for_shoot|dashboard\/production\/\$\{it\.id\}/)
    expect(src(SOP)).toMatch(/dashboard\/editor\?card=\$\{one\.id\}/)
    expect(src(SHOOT)).toMatch(/Plan canvas/)
    expect(src(SHOOT)).toMatch(/Notes for the team/)
  })
  it('the card link is the scheduler\u2019s Drive folder, in those words', () => {
    expect(src(CARD)).toMatch(/'Change the source working folder' : 'Add the source working folder'/)
    expect(src(CARD)).not.toMatch(/'Add a link'|'Replace the link'|Drive folder to post from/)
    expect(src(DIALOGS)).toMatch(/'Change the source working folder' : 'Source working folder'/)
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

describe('the shoot canvas is editable on a touch device (13 Sep 2026)', () => {
  const canvas = src('app/dashboard/production/shoots/[id]/BriefCanvas.tsx')
  it('the only view-only rule is the portal’s — a coarse pointer no longer hides the tools', () => {
    // Divina, on an iPad: "I can't control the width of the notes … can't
    // change colours and text width and size"
    expect(canvas).toMatch(/const viewOnly = readOnly$/m)
    expect(canvas).not.toMatch(/readOnly \|\| coarse/)
    expect(canvas).not.toContain('View only on mobile')
  })
  it('draws edge and corner handles and a toolbar above the selected card, with 44px grab areas', () => {
    expect(canvas).toMatch(/data-resize=\{mode\}/)
    expect(canvas).toMatch(/data-resize="se"/)
    expect(canvas).toMatch(/data-card-toolbar role="toolbar"/)
    expect(canvas).toMatch(/h-11 w-11 touch-none cursor-ew-resize/)
    // a heading's side handles sit on its bottom edge, clear of the comment bubble
    expect(canvas).toMatch(/card\.kind === 'label' \? '' : 'top-1\/2 -translate-y-1\/2'/)
  })
  it('a note’s toolbar carries every colour, the text size and Edit text; every card can be duplicated', () => {
    expect(canvas).toMatch(/aria-label=\{`Colour \$\{c\}`\}/)
    expect(canvas).toMatch(/aria-label="Text size"/)
    expect(canvas).toContain('Edit text')
    expect(canvas).toContain('Duplicate')
    expect(canvas).toMatch(/e\.key\.toLowerCase\(\) === 'd'/)
  })
  it('one way in for a link: a post’s link becomes a post, anything else a link card', () => {
    expect(canvas).toMatch(/const addFromLink = \(url: string, expectPost = false\)/)
    expect(canvas).toMatch(/addFromLink\(v\); setLinkPrompt\(false\)/)
    expect(canvas).toMatch(/addFromLink\(v, true\); setMockupMenu\(false\)/)
    expect(canvas).not.toMatch(/addCard\(\{ kind: 'link', url: v \}\)/)
    expect(canvas).toContain('Show as a post')
    expect(canvas).toContain("mockup: 'Post'")
  })
})

describe('Post approval is assets only (13 Sep 2026: "what is this video edit tag")', () => {
  const CARD = src('app/dashboard/board/BoardCard.tsx')
  it('the kind-of-work chip is not drawn on a Post approval card unless it is an internal task', () => {
    expect(CARD).toMatch(/const kindChip = editorFace \? null : schedulerFace \? \(internalTask \? 'Task' : null\) : lines\.kind/)
    expect(CARD).toMatch(/\{!folded && kindChip && <Chip/)
    expect(CARD).not.toMatch(/lines\.kind && !editorFace/)
  })
  it('the folder link is named plainly, and the kind of work is not changed from this board', () => {
    expect(CARD).toContain('Add the source working folder')
    expect(CARD).toContain('No folder link yet')
    expect(CARD).not.toMatch(/>\s*Add link\s*</)
    expect(CARD).toMatch(/!settled && !adhocPost && !editorFace && !schedulerFace && \(/)
  })
  it('the drawer eyebrow says Post, not the kind of work', () => {
    const D = src('app/dashboard/board/PostApprovalDetail.tsx')
    expect(D).toMatch(/uses_media === false \? \(kind\?\.name \?\? 'Task'\) : 'Post'/)
  })
  it('nobody is named by their email address on a board', () => {
    for (const p of ['app/dashboard/editor/page.tsx', 'app/dashboard/scheduler/page.tsx']) {
      const s = src(p)
      expect(s, p).not.toMatch(/u\.name \|\| u\.email/)
      expect(s, p).toMatch(/personLabel\(u\.name, u\.email\)/)
    }
    expect(src('app/lib/act-as-core.ts')).toMatch(/personLabel\(nameOf\(actor\)\)/)
  })
})

describe('a heading is drawn at its stored width (13 Sep 2026)', () => {
  it('has no maxWidth cap, so a drag on the handle shows up as it happens', () => {
    const src = readFileSync('app/dashboard/production/shoots/[id]/CanvasCard.tsx', 'utf8')
    expect(src).not.toMatch(/maxWidth: Math\.max\(card\.w/)
    expect(src).not.toMatch(/minWidth: 'min-content'/)
    expect(src).toMatch(/style=\{\{ width: card\.w, fontSize: LABEL_FONT_PX\[textSizeOf\(card\)\] \}\}/)
    // and the three alignments are on the toolbar for a note, heading or to-do
    const canvas = readFileSync('app/dashboard/production/shoots/[id]/BriefCanvas.tsx', 'utf8')
    expect(canvas).toMatch(/aria-label="Align"/)
    expect(canvas).toMatch(/CANVAS_TEXT_ALIGNS\.map/)
  })
})

describe('the home page loader covers the hero from the first paint (13 Sep 2026)', () => {
  it('the cover box is CSS black in the server HTML, and steps aside only once the canvas is painted', () => {
    const loader = src('app/components/lama/LamaLoader.tsx')
    expect(loader).toMatch(/useState\(true\)/)
    expect(loader).toMatch(/\$\{solid \? 'bg-black' : ''\}/)
    // the hand-over happens right after the canvas is filled black
    const fill = loader.indexOf('coverCtx.fillRect(0, 0, cover.width, cover.height)')
    const hand = loader.indexOf('setSolid(false)')
    expect(fill).toBeGreaterThan(0)
    expect(hand).toBeGreaterThan(fill)
    expect(hand - fill).toBeLessThan(200)
  })
})

describe('a link to a card is never hijacked by the tutorial (13 Sep 2026)', () => {
  it('the dashboard layout skips the first-run tutorial when the URL carries ?card=', () => {
    const s = src('app/dashboard/layout.tsx')
    const gate = s.indexOf("new URLSearchParams(window.location.search).has('card')")
    const offer = s.indexOf("router.replace('/dashboard/start')")
    expect(gate).toBeGreaterThan(0)
    expect(gate).toBeLessThan(offer)
  })
})

describe('the read-only plan page carries the quality checker’s two answers (14 Sep 2026)', () => {
  it('Pass the plan and Send back with a note are drawn for a reviewer on a plan in review', () => {
    const ro = src('app/dashboard/production/shoots/[id]/PlanReadOnly.tsx')
    expect(ro).toContain('Pass the plan')
    expect(ro).toContain('Send back with a note')
    expect(ro).toMatch(/data-plan-review/)
    expect(src(SHOOT)).toMatch(/canReview=\{viewerIsReviewer && !!batch\.review_asked_at && !batch\.plan_reviewed_at\}/)
  })
})

describe('a shoot’s plan page is not behind the shell’s section gate (14 Sep 2026)', () => {
  it('the shell resolves the plan page to no section, so the server decides who reads it', () => {
    const shell = src('app/dashboard/layout.tsx')
    expect(shell).toContain('shoots\\/[^/]+$/.test(path)) return null')
  })
})

describe('a board tile at a short height keeps its icon and words (14 Sep 2026)', () => {
  // the owner: "the board card when resize, it hides the emoji and text" —
  // the centred column was clipped at both ends while the hidden Open button
  // kept its row. Both canvases draw the tile from boardTileLayout now.
  it('both canvases ask boardTileLayout and float Open when the column would not fit', () => {
    for (const [file, h] of [
      ['app/dashboard/production/shoots/[id]/CanvasCard.tsx', 'card.h'],
      ['app/dashboard/boards/CanvasItemView.tsx', 'item.h'],
    ] as const) {
      const s = src(file)
      expect(s, file).toContain(`boardTileLayout(${h})`)
      expect(s, file).toMatch(/tile\.openFloats \? 'absolute inset-x-3 bottom-2' : 'mt-1'/)
      expect(s, file).toMatch(/tile\.small \? 'h-10 w-10' : 'h-14 w-14'/)
      // the icon box never shrinks under the words
      expect(s, file).toMatch(/flex shrink-0 items-center justify-center rounded-card/)
    }
  })

  it('the shoot brief tile takes text size, colour and alignment off the toolbar, like a heading', () => {
    // the owner, 14 Sep 2026: "allow the board to have toolbar too like size texts etc"
    const tile = src('app/dashboard/production/shoots/[id]/CanvasCard.tsx')
    expect(tile).toMatch(/const namePx = \(tile\.small \? NOTE_FONT_PX : LABEL_FONT_PX\)\[nameSize\]/)
    expect(tile).toMatch(/const nameInk = TEXT_COLOR_CLASS\[textColorOf\(card\) \?\? ''\]/)
    expect(tile).toMatch(/const nameAlign = textAlignOf\(card\)/)
    const canvas = src('app/dashboard/production/shoots/[id]/BriefCanvas.tsx')
    expect(canvas).toMatch(/const hasText = hasTextStyle\(card\.kind\)/)
    // a board renames in its own dialog: no "Edit text" on its bar
    expect(canvas).toMatch(/card\.kind !== 'todo' && card\.kind !== 'board' && \(/)
    // the align buttons know a board starts in the middle
    expect(canvas).toMatch(/align: al === baseAlign \? undefined : al/)
  })
})

describe('the reviewer’s card shows the finished edit as what it is (14 Sep 2026)', () => {
  // the owner's screenshot: the editor's submitted link appeared only as
  // "Open the folder" under Files to work from, "0 files · Add the finished
  // files" asked the reviewer for files, and the close × sat alone on a row
  it('Post approval’s drawer opens the finished edit above the folder, and the close sits in the corner', () => {
    const s = src('app/dashboard/board/PostApprovalDetail.tsx')
    // …unless the card has approved files: then the files are the edit, not the link (24 Sep 2026)
    expect(s).toMatch(/const finished = item && !approvedFiles \? finishedEditOf\(/)
    expect(s).toContain('data-finished-edit')
    expect(s).toContain('Open the finished edit · {finished.label}')
    expect(s).toMatch(/finished \? 'Add files' : 'Add the finished files'/)
    expect(s).toMatch(/className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full hover:bg-muted"/)
  })
  it('the link route marks what it saved, and the item patch never turns a finished edit into the folder', () => {
    expect(src('app/api/production/items/[id]/link/route.ts')).toContain('link_final: final,')
    // the folder box never replaces a finished edit — marked or merely different from the folder
    expect(src('app/api/production/items/[id]/route.ts')).toContain('const linkIsFolder = finishedEditOf(cur) === null')
  })
})

describe('delivery only is a switch on the shoot page (14 Sep 2026)', () => {
  it('the shoot page draws it for the managers, the route cascades it, and a plan card is born with it', () => {
    expect(src('app/dashboard/production/shoots/[id]/ShootSop.tsx')).toContain('data-deliver-only')
    // one drawn tick box on the shoot page (15 Sep 2026): the switch is a TickBox, the patch is the same
    expect(src('app/dashboard/production/shoots/[id]/ShootSop.tsx')).toMatch(/onPatch\('deliver_only', on\)/)
    expect(src('app/api/production/batches/[id]/route.ts')).toMatch(/if \('deliver_only' in patch\)/)
    expect(src('app/lib/plan-cards.ts')).toContain('deliver_only: batch.deliver_only ?? null')
  })
})

describe('the maker’s drawer is the editor’s alone (14 Sep 2026)', () => {
  it('on the Editor page everyone but an editor gets the manager’s drawer, so an emailed manager has buttons', () => {
    const s = src('app/dashboard/board/CardSheet.tsx')
    // …an editor, a general holder, or ANY holder while the card is in
    // their hands (15 Sep 2026): card-sheet-core.usesMakerDrawer decides
    expect(s).toContain('const maker = usesMakerDrawer(me, opened)')
    expect(s).toMatch(/editor && !adhoc && maker\s*\n\s*\? <EditorCardDrawer/)
    expect(s).not.toContain("me?.role === 'quality_checker'")
  })
})

describe('typing @ in a team note offers the people on the card (14 Sep 2026)', () => {
  it('both drawers hand the note box the card’s people, with email and job, and the face buttons wrap', () => {
    expect(src('app/dashboard/board/CardSaid.tsx')).toContain('<MentionBox')
    expect(src('app/dashboard/board/CardSaid.tsx')).toMatch(/members=\{isManager && toClient \? \[\] : mentionable\}/)
    for (const f of ['app/dashboard/board/PostApprovalDetail.tsx', 'app/dashboard/board/EditorCardDrawer.tsx']) {
      expect(src(f), f).toMatch(/mentionable=\{cardPeople\(item, team as never, clientLinks as never, me\?\.id\)\}/)
    }
    expect(src('app/dashboard/MentionBox.tsx')).toMatch(/\[m\.hint, m\.email\]\.filter\(Boolean\)\.join\(' · '\)/)
    // "Revisions done — ready for quality check" ran out of the card
    expect((src('app/dashboard/board/BoardCard.tsx').match(/h-auto min-h-11 max-w-full whitespace-normal rounded-full/g) ?? []).length).toBe(2)
  })
})

describe('a client’s comment on a board card reaches the manager on the full-screen board (14 Sep 2026)', () => {
  it('the link asks for the board full screen, the board obeys, and draws the thread inside its fixed layer', () => {
    const canvas = src('app/dashboard/production/shoots/[id]/BriefCanvas.tsx')
    expect(canvas).toMatch(/get\('board'\) === 'full'\) setFullscreen\(true\)/)
    expect(canvas).toContain('data-fullscreen-comments')
    expect(canvas).toMatch(/onFullscreen\?\.\(fullscreen\)/)
    const comments = src('app/dashboard/production/shoots/[id]/BriefBoardComments.tsx')
    expect(comments).toMatch(/panel: fullscreen \? panel : null, onFullscreen: setFullscreen/)
    expect(comments).toMatch(/\{openCard && !fullscreen && \(/)
  })
  it('a card an editor makes for themselves tells the client’s managers; the roster names people the way the picker does', () => {
    expect(src('app/api/production/items/route.ts')).toContain('notifyCardMade(user, item')
    const wf = src('app/lib/workflow.ts')
    expect(wf).toContain('export function notifyCardMade(actor: TeamUser, item: ContentItem)')
    // the client's OWN managers stay quiet; a super admin who does not manage
    // the client tells them (15 Sep 2026: "the AM was not notified")
    expect(wf).toContain("if (managers.some(m => m.id === actor.id)) return")
    expect(wf).not.toContain("if (actor.role === 'account_manager' || actor.role === 'super_admin') return")
    expect(src('app/lib/comment-tags.ts')).toContain('name: tagNameOf(u)')
    expect(src('app/lib/card-people-core.ts')).toContain('name: tagNameOf(u)')
  })
})

describe('a New post on Post approval is handed to a scheduler (14 Sep 2026)', () => {
  it('the picker lists scheduler users only, starts unpicked, and the post cannot be made without one', () => {
    const s = src('app/dashboard/board/BoardDialogs.tsx')
    expect(s).toContain("const handTo = forPosting ? team.filter(p => p.role === 'scheduler') : whoMakesIt(team as HandTo[])")
    expect(s).toContain("useState(forPosting ? '' : viewer.id)")
    expect(s).toMatch(/&& \(!forPosting \|\| !!owner\)/)
    expect(s).toContain("placeholder={forPosting ? 'Pick a scheduler' : 'Pick a person'}")
    expect(s).toContain('No scheduler on the Team page yet')
  })
})

describe('logging the client’s approval hands the card to a scheduler on the spot (14 Sep 2026)', () => {
  it('the approve move opens the Hand to dialog for a manager, prefilled with the approved Drive, and the folder never overwrites the finished edit', () => {
    const acts = src('app/dashboard/board/useCardActs.tsx')
    // 15 Sep 2026: the dialog opens BEFORE any move, and the hand-over
    // approves — the card never rests in Ready to post
    expect(acts).toContain('<HandToDialog card={handFor?.card ?? null} approve={handFor?.approve === true}')
    expect(acts).toMatch(/action\.to === 'approved_for_scheduling' && \['account_manager', 'super_admin', 'general'\]\.includes\(viewer\.role\) && card\.deliver_only !== true/)
    expect(acts).toContain('setHandFor({ card, approve: true }); return')
    expect(acts).not.toContain("setHandFor({ ...card, status: to }")
    const dialogs = src('app/dashboard/board/BoardDialogs.tsx')
    expect(dialogs).toContain("setPostFolder(card ? (folderOf(card as never)?.url ?? '') : '')")
    // the folder is saved as the folder to work from through the item PATCH, not as the card link
    expect(dialogs).toMatch(/method: 'PATCH', headers: \{ 'Content-Type': 'application\/json' \}, body: JSON\.stringify\(\{ raw_assets_url: check\.url \}\)/)
    expect(dialogs).not.toMatch(/\/link`, \{\s*method: 'PUT'[^}]*url: check\.url/)
  })
})

describe('a card still with the editor shows no files box on the manager’s drawer (14 Sep 2026)', () => {
  it('the versions section waits until the card is approved or is a post; until then it is the link, or waiting for it', () => {
    const s = src('app/dashboard/board/PostApprovalDetail.tsx')
    expect(s).toMatch(/const stillEditing = !!item && !adhoc && EDITING_STATUSES\.includes\(String\(item\.status\)\) && !handedToScheduler\(item\)/)
    expect(s).toContain('{(!stillEditing || !!approvedFiles) && (')
    expect(s).toContain('Waiting for the editor’s Drive or Dropbox link.')
  })
})

describe('the editor’s card borrows the plan only when the shoot made it (14 Sep 2026)', () => {
  it('reads the rows through briefRowsFor with the shoot-card check', () => {
    const s = src('app/dashboard/board/EditorCardDrawer.tsx')
    expect(s).toContain('const shootsOwn = !!item.batch_id && item.id === shootCardId(String(item.batch_id))')
    // a card made by hand that names a shoot wears no footage or plan press (16 Sep 2026)
    expect(s).toContain('{shootsOwn && shoot?.footage_handed_at && holder && (')
    expect(s).toContain('{shootsOwn && planRead.on && shoot ? (planRead.read')
    expect(s).toContain('const brief = briefRowsFor({')
    expect(s).not.toMatch(/const brief = beforeYouStart\(/)
  })
})

describe('the editor’s card opens the plan and its board, read only and without comments (14 Sep 2026)', () => {
  it('the card links to the shoot page; a read-only viewer gets the plan with the canvas and no comment thread or badges', () => {
    const drawer = src('app/dashboard/board/EditorCardDrawer.tsx')
    expect(drawer).toContain('data-plan-link')
    expect(drawer).toContain('href={`/dashboard/production/shoots/${shoot.id}`}')
    // only on the card the shoot made; a hand-made card that names a shoot has no plan link (16 Sep 2026)
    expect(drawer).toContain('{fromPlan && shoot && (')
    expect(drawer).toContain('const fromPlan = cardUsesPlan(item as never, shootCardId)')
    expect(drawer).toContain('{shootsOwn && shoot?.footage_handed_at && holder && (')
    expect(src('app/dashboard/editor/[id]/page.tsx')).toContain('}, fromPlan)')
    // the New card window asks, when a real shoot is picked (16 Sep 2026)
    const dialogs = src('app/dashboard/board/BoardDialogs.tsx')
    expect(dialogs).toContain('Include this shoot’s brief, plan and board on the card')
    expect(dialogs).toContain('...(batchId && includePlan ? { include_plan: true } : {}),')
    expect(src('app/api/production/items/route.ts')).toContain('include_plan: it.include_plan === true ? true : null,')
    const page = src('app/dashboard/production/shoots/[id]/page.tsx')
    expect(page).toMatch(/if \(readOnly\) \{[\s\S]*?<PlanReadOnly /)
    const plan = src('app/dashboard/production/shoots/[id]/PlanReadOnly.tsx')
    expect(plan).toContain('canEdit={false}')
    expect(plan).not.toMatch(/BriefComments|BriefBoardComments|CanvasCommentsProvider/)
  })
})

describe('a new shoot plan offers an account manager their own clients; a general user or super admin any (14 Sep 2026)', () => {
  it('the dialog narrows the client list by the managers on each client', () => {
    const s = src('app/dashboard/production/NewItemDialog.tsx')
    expect(s).toContain("role === 'account_manager'")
    expect(s).toContain('allClients.filter(c => (c.managers ?? []).some(m => m.id === me?.id))')
  })
})

describe('a scheduler’s upload on a card shows the same rows as the New post window (14 Sep 2026)', () => {
  it('the card owns an upload group, draws its rows with bytes, bar, speed and time left, and clears them once saved', () => {
    const s = src('app/dashboard/board/PostApprovalDetail.tsx')
    expect(s).toContain('const uploadGroup = `card:${id}`')
    expect(s).toContain('const cardUploads = useUploadGroup(uploadGroup)')
    expect(s).toContain("uploadFiles(files, { purpose: 'social', group: uploadGroup })")
    expect(s).toContain('<UploadRows uploads={cardUploads} onDismiss={dismissUpload} />')
    expect(s).toContain('clearGroup(uploadGroup)')
  })
})

describe('the Overview says when a footage folder is needed (14 Sep 2026)', () => {
  it('managers, super admins and general users get the tile, next to Shoot plans late', () => {
    const s = src('app/dashboard/page.tsx')
    expect(s).toContain("key: 'footage-needed'")
    expect(s).toContain("title: 'Footage folder needed'")
    expect(s).toContain('footageFolderNeeded(b as unknown as SopShoot, todayKey)')
    // inside the same role gate as the late tile
    const gate = s.indexOf("viewer.role === 'super_admin' || viewer.role === 'account_manager' || viewer.role === 'general'")
    expect(gate).toBeGreaterThan(-1)
    expect(s.indexOf("key: 'footage-needed'")).toBeGreaterThan(gate)
  })
})
