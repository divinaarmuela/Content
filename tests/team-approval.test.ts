import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { approvalBadge, captionsOf, sanitiseCaptions, withClipApproved } from '../app/lib/clip-approvals-core'

describe('team approvals, captions, and settling at once (18 Sep 2026)', () => {
  it('the badge says whose tick it was', () => {
    expect(approvalBadge({ file_id: 'a', name: 'a', at: 'x', by: 'Jerry' })).toBe('Approved by client · Jerry')
    expect(approvalBadge({ file_id: 'a', name: 'a', at: 'x', by: '' })).toBe('Approved by client')
    expect(approvalBadge({ file_id: 'a', name: 'a', at: 'x', by: 'Akmal', team: true })).toBe('Approved by Akmal')
    expect(approvalBadge(null)).toBeNull()
    // a team tick replaces the client's on the same clip, and the other way round
    const list = withClipApproved([{ file_id: 'a', name: 'a', at: 'x', by: 'Jerry' }], { file_id: 'a', name: 'a', at: 'y', by: 'Akmal', team: true })
    expect(list).toEqual([{ file_id: 'a', name: 'a', at: 'y', by: 'Akmal', team: true }])
  })
  it('captions are a clean map of file to words', () => {
    expect(captionsOf({ asset_captions: { a: ' Hello ', b: '', c: 3 } })).toEqual({ a: 'Hello' })
    expect(captionsOf({})).toEqual({})
    expect(sanitiseCaptions({ a: 'Hi', b: '  ' })).toEqual({ ok: true, captions: { a: 'Hi' } })
    expect(sanitiseCaptions(null)).toEqual({ ok: true, captions: {} })
    expect(sanitiseCaptions(['x'])).toEqual({ ok: false, error: 'Captions are a map of file to words' })
    expect(sanitiseCaptions({ 'bad key!': 'x' })).toEqual({ ok: false, error: 'That is not a file on the card' })
    expect(sanitiseCaptions({ a: 1 })).toEqual({ ok: false, error: 'A caption is words' })
  })
  it('the routes settle every approval at once, and the tiles carry the tick, the Approve and the caption', () => {
    const split = readFileSync('app/lib/split-approved.ts', 'utf8')
    expect(split).toContain("export async function settleApprovals(")
    expect(split).toContain("if (!['client_review', 'client_changes_requested'].includes(String(item.status))) return null")
    expect(split).toContain("await performTransition(actor, item as never, 'approved_for_scheduling', { note: 'Every clip approved' })")
    expect(split).toContain('async function openHandoverCardOf(')
    expect(split).toContain('asset_captions: { ...captionsOf(existing), ...movedCaptions },')
    const portal = readFileSync('app/api/portal/clip/route.ts', 'utf8')
    expect(portal).toContain('try { await settleApprovals(actor as never, { ...item, clip_approvals: next } as never) }')
    const team = readFileSync('app/api/production/items/[id]/approve-clip/route.ts', 'utf8')
    expect(team).toContain("const user = await requireRole('account_manager')")
    expect(team).toContain("by: user.name || user.email, team: true")
    const items = readFileSync('app/api/production/items/[id]/route.ts', 'utf8')
    expect(items).toContain("'final_files', 'asset_captions'] as const")
    expect(items).toContain('const cleaned = sanitiseCaptions(patch.asset_captions)')
    const tiles = readFileSync('app/dashboard/board/DriveFolderFiles.tsx', 'utf8')
    expect(tiles).toContain('<TileExtras tile={t} caption={captions?.[t.id] ?? \'\'} approved={!!clipApproval(approvals ?? [], t.id)} mayApprove={mayApprove} onApprove={onApprove} mayCaption={mayCaption} onCaption={onCaption} />')
    expect(tiles).toContain("{approvalBadge(clipApproval(approvals ?? [], t.id)) ?? 'Approved'}")
    const box = readFileSync('app/dashboard/board/FilesToWorkFrom.tsx', 'utf8')
    expect(box).toContain('const canApprove = mayApprove ?? isManager')
    expect(box).toContain('const canCaption = mayCaption ?? (isManager || holder)')
    expect(box).toContain("fetch(`/api/production/items/${item.id}/approve-clip`")
    expect(box).toContain("await save({ asset_captions: next }, words ? 'Caption saved' : 'Caption removed')")
    const detail = readFileSync('app/dashboard/board/PostApprovalDetail.tsx', 'utf8')
    expect(detail).toContain('mayCaption={isManager || (!!me?.id && (item.owner_id === me.id ||')
  })
})

describe('the reader keeps whose tick it was (18 Sep 2026)', () => {
  it('a team tick reads back as the team’s, with where it came from', async () => {
    const { clipApprovalsOf } = await import('../app/lib/clip-approvals-core')
    expect(clipApprovalsOf({ clip_approvals: [{ file_id: 'a', name: 'a', at: 'x', by: 'Akmal', team: true, ip: '1.2.3.4', device: 'phone' }] }))
      .toEqual([{ file_id: 'a', name: 'a', at: 'x', by: 'Akmal', team: true, ip: '1.2.3.4', device: 'phone' }])
    expect(clipApprovalsOf({ clip_approvals: [{ file_id: 'a', name: 'a', at: 'x', by: 'Jerry' }] })).toEqual([{ file_id: 'a', name: 'a', at: 'x', by: 'Jerry' }])
  })
})

describe('a replaced file is a new clip, and the clip page approves too (18 Sep 2026)', () => {
  it('a file changed in Drive under the same link is copied under its own id for the new round', () => {
    const s = readFileSync('app/lib/drive-pull.ts', 'utf8')
    expect(s).toContain("if (!same) files.push({ id: olds.length > 0 && round !== null ? `${f.id}-v${round}` : f.id,")
  })
  it('the clip page carries the manager\u2019s Approve for the client, and names whose approval it shows', () => {
    const p = readFileSync('app/dashboard/editor/[id]/video/[fileId]/page.tsx', 'utf8')
    expect(p).toContain("const mayApprove = me?.role === 'account_manager' || me?.role === 'super_admin'")
    expect(p).toContain('data-approve-for-client')
    expect(p).toContain("fetch(`/api/production/items/${id}/approve-clip`")
    expect(p).toContain("approvalBadge(approved)}.")
  })
})
