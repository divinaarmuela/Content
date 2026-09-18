import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { qcApprovalsOf, qcBadge } from '../app/lib/clip-approvals-core'
import { toClientTitle } from '../app/lib/version-approval-core'

describe('the quality check, one clip at a time (18 Sep 2026)', () => {
  it('the reviewer’s passes read like the client’s approvals, apart from them', () => {
    expect(qcApprovalsOf({ qc_approvals: [{ file_id: 'a', name: 'a', at: 'x', by: 'Joy', team: true }] })).toEqual([{ file_id: 'a', name: 'a', at: 'x', by: 'Joy', team: true }])
    expect(qcApprovalsOf({})).toEqual([])
    expect(qcBadge({ file_id: 'a', name: 'a', at: 'x', by: 'Joy' })).toBe('Passed quality check · Joy')
    expect(qcBadge(null)).toBeNull()
    expect(toClientTitle('Reel Day 3', 2)).toBe('Reel Day 3 — passed quality check, Version 2')
  })
  it('a pass settles at once: some passed go to the client on their own card, all passed sends the card itself', () => {
    const split = readFileSync('app/lib/split-approved.ts', 'utf8')
    expect(split).toContain('export async function settleQualityCheck(')
    expect(split).toContain("if (String(item.status) !== 'quality_check') return null")
    expect(split).toContain("await performTransition(actor, item as never, 'client_review', { note: 'Every clip passed the quality check' })")
    expect(split).toContain("const done = await moveToStage(actor, item, passedFiles, remaining.length, round, 'client')")
    // a to-the-client card is born at the quality check and SENT the normal way, so the client and the managers are told
    expect(split).toContain("status: stage === 'handover' ? 'approved_for_scheduling' : 'quality_check',")
    expect(split).toContain("card = (await performTransition(actor, card as never, 'client_review', { note: 'Passed the quality check, asset by asset' }))")
    const route = readFileSync('app/api/production/items/[id]/qc-pass-clip/route.ts', 'utf8')
    expect(route).toContain("if (!(isQualityReviewer(user) || user.role === 'super_admin')) {")
    expect(route).toContain("if (String(item.status) !== 'quality_check') return NextResponse.json(")
    expect(route).toContain('settled = await settleQualityCheck(user,')
  })
  it('the tiles carry the reviewer’s Pass and badge, the card page says who may pass, the manager’s Approve stays for the client’s stage', () => {
    const tiles = readFileSync('app/dashboard/board/DriveFolderFiles.tsx', 'utf8')
    expect(tiles).toContain("{passed ? 'Take back' : 'Pass — to the client'}")
    expect(tiles).toContain('{qcBadge(clipApproval(qcApprovals ?? [], t.id))}')
    const box = readFileSync('app/dashboard/board/FilesToWorkFrom.tsx', 'utf8')
    expect(box).toContain("const canQcPass = mayQcPass && String((item as { status?: unknown }).status ?? '') === 'quality_check'")
    expect(box).toContain("fetch(`/api/production/items/${item.id}/qc-pass-clip`")
    const page = readFileSync('app/dashboard/editor/[id]/page.tsx', 'utf8')
    expect(page).toContain("mayQcPass={!!me && (isQualityReviewer(me) || me.role === 'super_admin')}")
  })
})

describe('the stage buttons act on the rest, and say so (18 Sep 2026)', () => {
  it('counts what is left at the quality check and with the client, and words the button', async () => {
    const { versionRest, withRestWords } = await import('../app/lib/version-approval-core')
    const all = [{ id: 'a', version: 1 }, { id: 'b', version: 1 }, { id: 'c', version: 1 }]
    // at the quality check: a passed and moved on, b passed but not yet moved, c not passed
    const qc = { status: 'quality_check', edit_round: 1, split_out: ['a'], qc_approvals: [{ file_id: 'a', name: 'a', at: 'x', by: 'Joy' }, { file_id: 'b', name: 'b', at: 'x', by: 'Joy' }] }
    expect(versionRest(qc, all)).toEqual({ total: 3, movedOn: 1, rest: 1 })
    expect(withRestWords('Passed quality check', versionRest(qc, all))).toBe('Passed quality check — the 1 clip left')
    // with the client: a moved to handover, b and c still to approve
    const wc = { status: 'client_review', edit_round: 1, split_out: ['a'], clip_approvals: [{ file_id: 'a', name: 'a', at: 'x', by: 'Jerry' }] }
    expect(versionRest(wc, all)).toEqual({ total: 3, movedOn: 1, rest: 2 })
    expect(withRestWords('Send back for changes', versionRest(wc, all))).toBe('Send back for changes — the 2 clips left')
    // nothing moved on yet: the plain words
    expect(withRestWords('Passed quality check', versionRest({ status: 'quality_check', edit_round: 1 }, all))).toBe('Passed quality check')
  })
  it('one handover card per edit: a to-the-client card\u2019s approvals join the root\u2019s handover card', () => {
    const split = readFileSync('app/lib/split-approved.ts', 'utf8')
    expect(split).toContain('const anchor = await rootOf(item)')
    expect(split).toContain('async function rootOf(item: ContentItem): Promise<ContentItem> {')
    expect(split).toContain("&& typeof (r as { merged_into?: unknown }).merged_into !== 'string'")
    // the last approval joins the open handover card and closes this one, pointing at it
    expect(split).toContain("const existing = await openChildOf(root, 'handover')")
    expect(split).toContain("const done = await moveToStage(actor, item, handoff, 0, round, 'handover')")
    expect(split).toContain("await table<ContentItem>('content_items').update(item.id, { merged_into: existing.id, updated_at: new Date().toISOString() } as never)")
    // a to-the-client card accepted whole is titled as the handover card
    expect(split).toContain('title: handoffTitle(root.title, typeof src.split_round === \'number\' ? src.split_round : round)')
    // the comments follow the clip
    expect(split).toContain("const said = await table<ItemComment>('item_comments').list({ by: { item_id: item.id } as never })")
    expect(split).toContain('const replies = said.filter(c => !movedIds.has(c.id) && typeof c.parent_id === \'string\' && movedIds.has(c.parent_id))')
    expect(split).toContain('const existing = await openChildOf(anchor, stage)')
    expect(split).toContain('split_from: anchor.id,')
    const page = readFileSync('app/dashboard/editor/[id]/page.tsx', 'utf8')
    expect(page).toContain("{busy ? 'Saving…' : said(primary.label)}")
    expect(page).toContain('const said = (label: string) => withRestWords(label, counts)')
  })
})

describe('a closed card — all its clips moved on (18 Sep 2026)', () => {
  it('is done on every board and never in a working lane, and says so', async () => {
    const { mergedAway, MERGED_WORDS, groupByLane, pageLanes } = await import('../app/lib/board-view-core')
    expect(mergedAway({ merged_into: 'h1' })).toBe(true)
    expect(mergedAway({})).toBe(false)
    expect(MERGED_WORDS).toBe('All clips on the handover card')
    const card = { id: 'a', status: 'approved_for_scheduling', merged_into: 'h1' } as never
    const editor = groupByLane(pageLanes('editor'), [card])
    expect(editor.find(g => g.lane.key === 'done')!.cards).toHaveLength(1)
    expect(editor.filter(g => g.lane.key !== 'done').every(g => g.cards.length === 0)).toBe(true)
    const tiles = readFileSync('app/dashboard/board/BoardCard.tsx', 'utf8')
    expect(tiles).toContain('mergedAway(card as never) ? MERGED_WORDS : lines.stage')
    const page = readFileSync('app/dashboard/editor/[id]/page.tsx', 'utf8')
    expect(page).toContain('Every clip on this card was approved and is on the handover card.')
    const portal = readFileSync('app/portal/[token]/edit/[id]/page.tsx', 'utf8')
    expect(portal).toContain('if (data.item.merged_into) redirect(editingPortalPath(raw, data.item.merged_into))')
  })
  it('a version counts a file once, the good copy winning over a stale failed pull', async () => {
    const { finishedVersionsOf } = await import('../app/lib/edit-round-core')
    const rows = [
      { kind: 'item', scope_id: 'i', purpose: 'finished', status: 'failed', started_at: '1', folder_url: 'https://d/1', files: [{ id: 'a', name: 'a.mov', status: 'failed', version: 1 }] },
      { kind: 'item', scope_id: 'i', purpose: 'finished', status: 'done', started_at: '2', folder_url: 'https://d/2', files: [{ id: 'a', name: 'a.mov', status: 'done', url: 'https://x/a', version: 1 }, { id: 'b', name: 'b.mov', status: 'done', url: 'https://x/b', version: 1 }] },
    ]
    const tabs = finishedVersionsOf(rows as never, { itemId: 'i', finishedFolderId: null, filesOf: r => (r as { files: { id: string; status: string; url?: string; version: number }[] }).files })
    expect(tabs).toHaveLength(1)
    expect(tabs[0].files.map(f => f.id)).toEqual(['a', 'b'])
    expect(tabs[0].files[0].status).toBe('done')
  })
})
