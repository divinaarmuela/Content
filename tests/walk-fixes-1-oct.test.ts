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
    expect(readFileSync('app/dashboard/layout.tsx', 'utf8')).toContain('if (!isPlainVisit(window.location.pathname, window.location.search)) return')
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
})
