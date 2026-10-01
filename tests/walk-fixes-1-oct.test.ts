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
