import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { gradeReadyProblem, needsColourGrade } from '../app/lib/colour-grade-core'
import { nextSplitRound, roundNote, roundTitle, splitPlan } from '../app/lib/split-core'
import { checkTransitionAs, presentTransitions, availableTransitionsAs } from '../app/lib/workflow-core'

/* ── docs/COLOUR_GRADE_SPLIT_SPEC.md ── */

const file = (id: string, name: string, version = 1, extra: Record<string, unknown> = {}) =>
  ({ id, name, url: `https://x/${id}`, mime: 'video/mp4', size: 1, version, uploaded_at: '2026-10-01T00:00:00Z', ...extra })

describe('C1 — which cards are graded', () => {
  it('every video edit; never graphics, copy, plans or untyped cards', () => {
    expect(needsColourGrade('edit')).toBe(true)
    for (const k of ['graphics', 'copy', 'shoot_brief', 'other', null, undefined]) expect(needsColourGrade(k)).toBe(false)
  })
  it('the quality check offers colour grade for a video edit, the client for everything else', () => {
    const offered = availableTransitionsAs(['quality_reviewer'], 'quality_check')
    const video = presentTransitions(['quality_reviewer'], 'quality_check', offered, { clientApprovalRequired: true, viewerHoldsTurn: true, gradeFirst: true })
    expect(video.primary?.to).toBe('colour_grade')
    expect([video.primary, ...video.secondary].some(t => t?.to === 'client_review' || t?.to === 'approved_for_scheduling')).toBe(false)
    const design = presentTransitions(['quality_reviewer'], 'quality_check', offered, { clientApprovalRequired: true, viewerHoldsTurn: true, gradeFirst: false })
    expect(design.primary?.to).toBe('client_review')
    expect(design.secondary.some(t => t.to === 'colour_grade')).toBe(false)
  })
  it('the server refuses a video edit past colour grade, and anything else into it', () => {
    const src = readFileSync('app/lib/workflow.ts', 'utf8')
    expect(src).toContain("if (!system && actor.role !== 'super_admin' && String(item.status) === 'quality_check' && needsColourGrade(kindSlug) && (to === 'client_review' || to === 'approved_for_scheduling')) {")
    expect(src).toContain("if (to === 'colour_grade' && !needsColourGrade(kindSlug)) {")
  })
})

describe('C3–C5 — the colourist', () => {
  it('passes nothing out of the quality check; puts the graded cut on the portal, or sends it back', () => {
    expect(checkTransitionAs(['colourist'], 'quality_check', 'colour_grade').ok).toBe(false)
    expect(checkTransitionAs(['quality_reviewer'], 'quality_check', 'colour_grade').ok).toBe(true)
    expect(checkTransitionAs(['colourist'], 'colour_grade', 'client_review').ok).toBe(true)
    expect(checkTransitionAs(['colourist'], 'colour_grade', 'revision_required').ok).toBe(true)
    expect(checkTransitionAs(['editor'], 'colour_grade', 'client_review').ok).toBe(false)
  })
  it('the graded cut must have landed for this version, and nothing still copying', () => {
    expect(gradeReadyProblem({ graded_round: null }, 1, false)).toMatch(/Hand in the graded Google Drive link first/)
    expect(gradeReadyProblem({ graded_round: 1 }, 2, false)).toMatch(/Hand in the graded/)
    expect(gradeReadyProblem({ graded_round: 1 }, 1, true)).toMatch(/still copying/)
    expect(gradeReadyProblem({ graded_round: 1 }, 1, false)).toBeNull()
  })
  it('a hand-in settled at colour grade stamps the graded version; the editor cannot hand in there', () => {
    const settle = readFileSync('app/lib/drive-handin.ts', 'utf8')
    expect(settle).toContain("...(result.ok && String((cur as { status?: unknown }).status ?? '') === 'colour_grade' ? { graded_round: round } : {}),")
    expect(readFileSync('app/lib/final-files-core.ts', 'utf8')).toContain("export const LOOKING_STATUSES = ['quality_check', 'colour_grade', 'client_review']")
  })
})

describe('C6–C9 — the split', () => {
  const item = (over: Record<string, unknown> = {}) => ({
    status: 'client_review', edit_round: 1,
    final_files: [file('a', 'Justin 2.mov'), file('b', 'Justin 3.mov'), file('c', 'Justin 5.mov')],
    clip_approvals: [{ file_id: 'a', name: 'Justin 2.mov', at: 't', by: 'J' }],
    ...over,
  })
  it('approved stay, the rest leave; all approved or none is not a split', () => {
    const p = splitPlan(item())
    expect(p.kind).toBe('split')
    if (p.kind !== 'split') return
    expect(p.approved.map(v => v.name)).toEqual(['Justin 2.mov'])
    expect(p.open.map(v => v.name)).toEqual(['Justin 3.mov', 'Justin 5.mov'])
    expect(splitPlan(item({ clip_approvals: [] })).kind).toBe('none')
    expect(splitPlan(item({ clip_approvals: ['a', 'b', 'c'].map(id => ({ file_id: id, name: id, at: 't', by: 'J' })) })).kind).toBe('all')
    expect(splitPlan(item({ status: 'quality_check' })).kind).toBe('refused')
  })
  it('only the videos shown at this version count — a video dropped earlier is not split again', () => {
    const p = splitPlan(item({ final_files: [file('a', 'A'), file('b', 'B', 1, { retired_round: 1 }), file('c', 'C')] }))
    expect(p.kind === 'split' && p.open.map(v => v.name)).toEqual(['C'])
  })
  it('the Round N card: its title, its number, and what the editor reads', () => {
    expect(roundTitle('September Videos - Justin', null)).toBe('September Videos - Justin · Round 2')
    expect(roundTitle('September Videos - Justin · Round 2', 2)).toBe('September Videos - Justin · Round 3')
    expect(nextSplitRound(null)).toBe(2)
    expect(nextSplitRound(3)).toBe(4)
    const note = roundNote([{ id: 'b', asset_id: 'b', name: 'Justin 3.mov', url: 'https://x/b' }], [{ video_file_id: 'b', visibility: 'client', body: 'Too dark' }, { video_file_id: 'b', visibility: 'internal', body: 'team only' }], 1)
    expect(note).toContain('• Justin 3.mov — the client said: Too dark')
    expect(note).not.toContain('team only')
    expect(note).toContain('Upload a new Google Drive link')
  })
  it('the original is claimed first (with the client, not already split) and put back if the new card fails', () => {
    const src = readFileSync('app/lib/split.ts', 'utf8')
    expect(src).toContain("if (!cur || cur.status !== 'client_review' || (cur as { split_at?: unknown }).split_at) return null")
    expect(src).toContain('for (const v of plan.open) files = withRetired(files, v.asset_id, null)')
    expect(src).toContain("await performTransition(actor, original as never, 'approved_for_scheduling', {")
  })
  it('two doors: the client (Send my answers, with a name, on their own portal) and a manager', () => {
    const act = readFileSync('app/api/portal/act/route.ts', 'utf8')
    expect(act).toContain("if (action === 'send_answers') {")
    expect(act).toContain("if (!authorName) return NextResponse.json({ error: 'Add your name so the team knows who answered' }, { status: 400 })")
    const team = readFileSync('app/api/production/items/[id]/split/route.ts', 'utf8')
    expect(team).toContain("if (!['account_manager', 'super_admin'].includes(user.role)) throw new AuthzError")
  })
  it('the client is never emailed by a split — the editor is told', () => {
    const src = readFileSync('app/lib/split.ts', 'utf8')
    expect(src).not.toContain('toClient')
    expect(src).toContain("eventType: 'split_round'")
  })
})

describe('the colourist\'s desk, whatever their role (2 Oct 2026, the walk: an editor ticked Colourist was refused the card)', () => {
  it('a card at colour grade opens for them, shows on their Editor board, and opens in the view with the panel', async () => {
    expect(readFileSync('app/lib/production-access.ts', 'utf8')).toContain("if ((user as { colourist?: unknown }).colourist === true && item.status === 'colour_grade') {")
    const { pageCards } = await import('../app/lib/board-view-core')
    const cards = [
      { id: 'mine', status: 'draft_uploaded', owner_id: 'e1' },
      { id: 'grade', status: 'colour_grade', owner_id: 'someone' },
      { id: 'other', status: 'client_review', owner_id: 'someone' },
    ] as never[]
    expect(pageCards('editor', cards, { id: 'e1', role: 'editor', colourist: true } as never).map((c: { id: string }) => c.id)).toEqual(['mine', 'grade'])
    expect(pageCards('editor', cards, { id: 'e1', role: 'editor' } as never).map((c: { id: string }) => c.id)).toEqual(['mine'])
    const { usesMakerDrawer } = await import('../app/lib/card-sheet-core')
    expect(usesMakerDrawer({ id: 'e1', role: 'editor', colourist: true }, { owner_id: 'someone', status: 'colour_grade' })).toBe(false)
    expect(usesMakerDrawer({ id: 'e1', role: 'editor', colourist: true }, { owner_id: 'e1', status: 'draft_uploaded' })).toBe(true)
  })
})

describe('a super admin chooses: colour grade, or straight to the client (the owner, 2 Oct 2026)', () => {
  it('two skip buttons on a video edit; the server lets only a super admin past colour grade', () => {
    const drawer = readFileSync('app/dashboard/board/EditorCardDrawer.tsx', 'utf8')
    expect(drawer).toContain("const to = gradeNext && !straightToClient ? 'colour_grade' : item.client_approval_required === false ? 'approved_for_scheduling' : 'client_review'")
    expect(drawer).toContain('onClick={() => void skipCheck(true)} data-skip-to-client')
  })
})

describe('the Round N card shows the unapproved videos and what the client said (the owner, 2 Oct 2026)', () => {
  it('the videos as files to work from, the client notes as the card thread', async () => {
    const { notApprovedFiles, carriedNotes } = await import('../app/lib/split-core')
    const open = [{ id: 'b', asset_id: 'b', name: 'Justin 3.mov', url: 'https://x/b' }, { id: 'c', asset_id: 'c', name: 'Justin 5.mov', url: null }]
    expect(notApprovedFiles(open)).toEqual([{ url: 'https://x/b', name: 'Not approved — Justin 3.mov' }])
    expect(carriedNotes(open, [
      { video_file_id: 'b', visibility: 'client', body: 'Too dark' },
      { video_file_id: 'b', visibility: 'internal', body: 'team only' },
      { video_file_id: 'a', visibility: 'client', body: 'approved one' },
    ])).toEqual(['The client on Justin 3.mov: Too dark'])
    const src = readFileSync('app/lib/split.ts', 'utf8')
    expect(src).toContain('raw_assets: [...notApprovedFiles(plan.open),')
    expect(src).toContain('for (const body of carriedNotes(plan.open, notes)) {')
  })
})

describe('a Round N card carries only its own round\'s unapproved videos (2 Oct 2026, the Round 3 walk)', () => {
  it('earlier rounds\' "Not approved" videos are left behind; the footage stays', async () => {
    const { footageOnly } = await import('../app/lib/split-core')
    expect(footageOnly([{ url: 'u1', name: 'Not approved — 8. HECS debt.mov' }, { url: 'u2', name: 'Raw clip A.mov' }])).toEqual([{ url: 'u2', name: 'Raw clip A.mov' }])
    expect(footageOnly(null)).toEqual([])
    expect(readFileSync('app/lib/split.ts', 'utf8')).toContain('raw_assets: [...notApprovedFiles(plan.open), ...footageOnly(src.raw_assets)],')
  })
})

describe('the screens say what they do (3 Oct 2026: "all buttons make sense?")', () => {
  it('beside Split, the whole-card buttons say "all N"; the designer board has no empty Colour grade column', async () => {
    const page = readFileSync('app/dashboard/editor/[id]/page.tsx', 'utf8')
    expect(page).toContain("a.kind === 'send_back' ? { ...a, label: `Send all ${whole} back for changes` }")
    expect(page).toContain("{ ...a, label: `${a.label} — all ${whole}` }")
    expect(readFileSync('app/dashboard/designer/page.tsx', 'utf8')).toContain("hideEmptyLanes={['colour_grade']}")
    const { DESIGN_LANE_WORDS, EDITOR_LANE_WORDS } = await import('../app/lib/editor-sop-core')
    expect(DESIGN_LANE_WORDS).toBe('In Progress, Quality check, With client, For Handoff, Done')
    expect(EDITOR_LANE_WORDS).toContain('Colour grade')
    for (const f of ['app/dashboard/editor/page.tsx', 'app/dashboard/designer/page.tsx']) expect(readFileSync(f, 'utf8')).not.toMatch(/five columns: \$\{/)
  })
})
