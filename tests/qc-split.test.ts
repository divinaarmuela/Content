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
    expect(split).toContain("const anchor = stage === 'handover' && typeof src.split_from === 'string' && src.split_from")
    expect(split).toContain('const existing = await openChildOf(anchor, stage)')
    expect(split).toContain('split_from: anchor.id,')
    const page = readFileSync('app/dashboard/editor/[id]/page.tsx', 'utf8')
    expect(page).toContain("{busy ? 'Saving…' : said(primary.label)}")
    expect(page).toContain('const said = (label: string) => withRestWords(label, counts)')
  })
})
