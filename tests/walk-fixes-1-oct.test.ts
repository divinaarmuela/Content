import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { handInOutdated } from '../app/lib/drive-handin-core'

// the second-half walk, 1 Oct 2026 (editor → quality check → client → handover → scheduler)
describe('fixes from the 1 Oct walk', () => {
  const sa = { id: 'u', role: 'super_admin', clientIds: null }
  it('a Drive hand-in line goes once files are uploaded after it', () => {
    const h = { id: 'h', pull_id: 'p', link: 'l', drive_ids: [], round: 3, settled_round: 3, by: null, requested_at: '2026-10-01T03:00:00Z', settled_at: '2026-10-01T03:01:00Z', status: 'done', file_ids: [], carried: ['a'] }
    const base = { status: 'revision_required', edit_round: 3, client_round: 2, client_rounds: [1, 2], drive_handins: [h] }
    expect(handInOutdated({ ...base, final_files: [] })).toBe(false)
    expect(handInOutdated({ ...base, final_files: [{ id: 'f', name: 'x.png', url: 'https://cdn.test/x.png', mime: 'image/png', size: 1, version: 3, uploaded_at: '2026-10-01T03:10:00Z', by: 'e', source: 'upload' }] })).toBe(true)
  })
  it('"Approve Version" sends one email: quiet ticks, one summary — none when the piece approval tells', () => {
    const route = readFileSync('app/api/portal/clip/route.ts', 'utf8')
    expect(route).toContain("const quiet = body.quiet === true")
    expect(route).toContain("if (decision === 'approve' && !quiet) {")
    const page = readFileSync('app/components/portal/EditingReview.tsx', 'utf8')
    expect(page).toContain('quiet: decides || !last')
  })
  it('the upload popup no longer promises per-file replacing', () => {
    expect(readFileSync('app/dashboard/board/EditorCardDrawer.tsx', 'utf8')).not.toContain('only that one is replaced and the rest stay as they are')
  })
})

describe('fixes from the batch walk (1 Oct 2026)', () => {
  it('New card does not pick a client for you unless there is only one', () => {
    const d = readFileSync('app/dashboard/board/BoardDialogs.tsx', 'utf8')
    expect(d).toContain("(clients.length === 1 ? clients[0].id : '')")
    expect(d).not.toContain("(clients[0]?.id ?? '')")
  })
  it('the scheduler’s email subject names the drafts waiting on Post approval', () => {
    expect(readFileSync('app/lib/workflow.ts', 'utf8')).toContain("draft posts`} on Post approval`")
  })
  it('"Hand in again" only after a Drive hand-in', () => {
    expect(readFileSync('app/dashboard/board/EditorCardDrawer.tsx', 'utf8')).toContain('{driveHandInsOf(item as never).length === 0 ? `Hand in from Google Drive')
  })
})

describe('Post approval’s post window offers the card’s files, every version (1 Oct 2026)', () => {
  it('OpenPostWindow builds the piece from the post’s own card, as the Schedule page does', () => {
    const w = readFileSync('app/dashboard/social/schedule/PostWindow.tsx', 'utf8')
    expect(w).toContain("const { row: item } = useRow<ContentItem>('content_items', itemId)")
    expect(w).toContain('const groups = cardVersionGroups(item as never')
    expect(w).toContain('<PostWindow postId={postId} seed={seed} context={context}')
  })
})

describe('a link to one thing never lands on How this works (1 Oct 2026)', () => {
  it('only a plain visit to a section may open the tutorial', async () => {
    const { isPlainVisit } = await import('../app/lib/tutorial-core')
    expect(isPlainVisit('/dashboard', '')).toBe(true)
    expect(isPlainVisit('/dashboard/editor', '')).toBe(true)
    expect(isPlainVisit('/dashboard/editor', '?card=abc')).toBe(false)
    expect(isPlainVisit('/dashboard/editor/abc', '')).toBe(false)
    expect(isPlainVisit('/dashboard/scheduler', '?post=p1')).toBe(false)
    expect(isPlainVisit('/dashboard/social/schedule', '?client=c&post=p')).toBe(false)
    expect(isPlainVisit('/dashboard/clients/c1/social', '')).toBe(false)
    // …and since 5 Oct 2026 the layout sends nobody there at all, and the sidebar has no entry for it
    expect(readFileSync('app/dashboard/layout.tsx', 'utf8')).not.toContain("router.replace('/dashboard/start')")
    expect(readFileSync('app/dashboard/ui/Shell.tsx', 'utf8')).not.toContain("label: 'How this works'")
  })
})

describe('a designer uploads; the Drive hand-in is the editors’ (1 Oct 2026)', () => {
  it('a graphics card’s main button uploads, and it offers no Drive hand-in', () => {
    const d = readFileSync('app/dashboard/board/EditorCardDrawer.tsx', 'utf8')
    expect(d).toContain("=== 'graphics'")
    expect(d).toContain('if (designCard) { setUploadOpen(true); return }')
    expect(d).toContain('Upload the finished files — {roundLabel(handInRound(item as never))}')
    expect(d).toContain('{!designCard && !(holder && submitting && !hasFinishedWork(item as never)) && (')
  })
})

describe('a shoot brief opens for whoever made it or assigned its review (1 Oct 2026)', () => {
  it('created_by and review_asked_by hold the shoot', async () => {
    const { madeOrAssignedShoot } = await import('../app/lib/shoot-sop-core')
    const { heldBatchIdsOf } = await import('../app/lib/scope-client')
    expect(madeOrAssignedShoot({ created_by: 'u1' }, 'u1')).toBe(true)
    expect(madeOrAssignedShoot({ review_asked_by: 'u2' }, 'u2')).toBe(true)
    expect(madeOrAssignedShoot({ created_by: null, review_asked_by: null }, 'u3')).toBe(false)
    const viewer = { id: 'u2', role: 'account_manager' } as Parameters<typeof heldBatchIdsOf>[0]
    expect(heldBatchIdsOf(viewer, [], [{ id: 'b', client_id: 'c', review_asked_by: 'u2' }]).has('b')).toBe(true)
  })
  it('the canvas frames only cards with something in them', () => {
    const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'app/dashboard/production/shoots/[id]/BriefCanvas.tsx'), 'utf8')
    expect(src).toMatch(/const framed = filled\.length > 0 \? filled : visible/)
  })
  it('a note left empty is removed when its editing ends, never saved blank', () => {
    const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'app/dashboard/production/shoots/[id]/BriefCanvas.tsx'), 'utf8')
    expect(src).toMatch(/\(card\.kind === 'note' \|\| card\.kind === 'label'\) && !text\.trim\(\)\) \{\s*setCards\(prev => prev\.filter\(c => c\.id !== card\.id\)\)[\s\S]{0,120}persist\(\[\], \[card\.id\]\)/)
  })
})

describe('the designer walk (1 Oct 2026)', () => {
  const read = (p: string) => require('node:fs').readFileSync(require('node:path').join(__dirname, '..', p), 'utf8') as string
  it('New card reads the picked files before clearing the input', () => {
    const src = read('app/dashboard/board/BoardDialogs.tsx')
    expect(src).toMatch(/const picked = Array\.from\(e\.target\.files \?\? \[\]\)\s*setWorkFiles\(w => \[\.\.\.w, \.\.\.picked\]\); e\.target\.value = ''/)
    expect(src).not.toMatch(/setWorkFiles\(w => \[\.\.\.w, \.\.\.Array\.from\(e\.target\.files/)
  })
  it('a graphics card offers Replace, Drop and Take off per file', () => {
    const src = read('app/dashboard/board/EditorCardDrawer.tsx')
    expect(src).toMatch(/designCard && \(holder \|\| isManager\) && !frozen/)
    expect(src).toMatch(/>Replace</)
    expect(src).toMatch(/Drop from \{roundLabel/)
    expect(src).toMatch(/>Take off</)
  })
  it('a designer ticks a designer\'s checks, and the server takes them', async () => {
    const { qcComplete, DESIGN_QC_CHECKLIST, QC_CHECKLIST } = await import('../app/lib/editor-sop-core')
    const design = DESIGN_QC_CHECKLIST.map(c => c.key)
    expect(DESIGN_QC_CHECKLIST.some(c => /audio|transition|export/i.test(c.label))).toBe(false)
    expect(qcComplete(design, true)).toBe(true)
    expect(qcComplete(design)).toBe(false)
    expect(qcComplete(QC_CHECKLIST.map(c => c.key))).toBe(true)
    const { flagCheck } = await import('../app/lib/card-flag-core')
    expect(flagCheck({ kind: 'qc_done', viewer: { id: 'u', role: 'editor' }, ownerId: 'u', ticks: design } as never).ok).toBe(true)
  })
  it('the portal shows no timeline or stamp under a picture', () => {
    const src = read('app/components/portal/EditingReview.tsx')
    expect(src).toMatch(/const at = stamp && !isImage/)
    expect(src).toMatch(/\{!isImage && <div className="relative mx-5 my-4 h-8"/)
    expect(src).toMatch(/\{!isImage && \(\s*<label/)
  })
  it('no "With client · With the client"', async () => {
    const { reviewWords } = await import('../app/lib/editor-sop-core')
    expect(reviewWords('client_review')).toBeNull()
  })
})

describe('the designer walk, second pass (1 Oct 2026)', () => {
  const read = (p: string) => require('node:fs').readFileSync(require('node:path').join(__dirname, '..', p), 'utf8') as string
  it('the card waits for its kind before drawing, so a design never flashes as a video card', () => {
    expect(read('app/dashboard/board/EditorCardDrawer.tsx')).toMatch(/if \(!item \|\| \(kindLoading && item\.work_kind_id && !\(item as \{ work_kinds\?: unknown \}\)\.work_kinds\)\)/)
  })
  it('a design is never a "cut"', () => {
    expect(read('app/components/portal/EditingReview.tsx')).toMatch(/isImage \? 'Newest' : 'Newest cut'/)
    expect(read('app/dashboard/board/DriveFolderFiles.tsx')).toMatch(/newCut && t\.kind !== 'image' \? 'New cut' : 'New'/)
  })
})

describe('the editor walk (1 Oct 2026)', () => {
  it('a card with the client whose Drive hand-in is still copying is on its way, not a 404', async () => {
    const { portalWaitingOnFiles } = await import('../app/lib/editing-portal-core')
    const handIn = [{ id: 'h', drive_ids: ['x'], status: 'copying' }]
    expect(portalWaitingOnFiles({ status: 'client_review', drive_handins: handIn, final_files: [] })).toBe(true)
    expect(portalWaitingOnFiles({ status: 'client_review', drive_handins: handIn, final_files: [{ id: 'f' }] })).toBe(false)
    expect(portalWaitingOnFiles({ status: 'draft_uploaded', drive_handins: handIn, final_files: [] })).toBe(false)
    expect(portalWaitingOnFiles({ status: 'client_review', drive_handins: [], final_files: [] })).toBe(false)
    // a copy that failed never arrives — not "on its way"
    expect(portalWaitingOnFiles({ status: 'client_review', drive_handins: [{ id: 'h', drive_ids: ['x'], status: 'failed' }], final_files: [] })).toBe(false)
    const page = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'app/portal/[token]/edit/[id]/page.tsx'), 'utf8')
    expect(page).toMatch(/const waiting = await editingPortalWaiting\(raw, id\)\s*if \(!waiting\) notFound\(\)/)
  })
  it('the editor intro names the real buttons', async () => {
    const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'app/lib/getting-started-core.ts'), 'utf8')
    expect(src).not.toMatch(/press "Ready for checking"|Press "Ready for checking"|Pick the final from Google Drive|Flag a deadline risk|Press Acknowledge/)
  })
})

describe('submit while copying, carried through (1 Oct 2026, the editor walk)', () => {
  const read = (p: string) => require('node:fs').readFileSync(require('node:path').join(__dirname, '..', p), 'utf8') as string
  it('the quality check cannot pass a card whose Drive files have not landed', () => {
    expect(read('app/lib/workflow.ts')).toMatch(/String\(item\.status\) === 'quality_check' && \(to === 'client_review' \|\| to === 'approved_for_scheduling'\)\s*&& !hasFiles && pendingHandIn\(item as never\)\)/)
    expect(read('app/lib/board-view-core.ts')).toMatch(/const stillCopying = card\.status === 'quality_check' && finalFilesOf\(card as never\)\.length === 0 && !!pendingHandIn\(card as never\)/)
  })
  it('a copy that finishes after the card moved on still lands when the version has no files', () => {
    expect(read('app/lib/drive-handin.ts')).toMatch(/LOOKING_STATUSES\.includes\(String\(\(cur as \{ status\?: unknown \}\)\.status \?\? ''\)\) && !before\.some\(f => f\.version === round\)/)
  })
})
