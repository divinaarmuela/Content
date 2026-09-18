import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { approvedIdSet, carriedInto, handoffTitle, movedIdSet, splitApproved, versionSet } from '../app/lib/version-approval-core'
import { sharedFilesOf } from '../app/lib/share-link-core'

describe('the approved clips leave with their own card (17 Sep 2026)', () => {
  const all = [
    { id: 'a', name: 'a.png', version: 1 },
    { id: 'b', name: 'b.png', version: 1 },
    { id: 'c', name: 'c.png', version: 1 },
  ]
  it('splits a version into what goes to handover and what stays with the editor', () => {
    const approved = approvedIdSet([{ file_id: 'a' }, { file_id: 'c' }])
    const v1 = versionSet(all, 1, approved)
    expect(splitApproved(v1, approved)).toEqual({ handoff: [all[0], all[2]], remaining: [all[1]] })
    expect(splitApproved(v1, new Set())).toEqual({ handoff: [], remaining: all })
    expect(handoffTitle('October Graphics', 2)).toBe('October Graphics — approved from Version 2')
    expect(handoffTitle('  ', 1)).toBe('Untitled — approved from Version 1')
  })
  it('a clip that left is out of every later version: not carried, not listed, not shared', () => {
    const approved = approvedIdSet([{ file_id: 'a' }, { file_id: 'c' }])
    const moved = movedIdSet({ split_out: ['a', 'c'] })
    expect(movedIdSet({})).toEqual(new Set())
    expect(carriedInto(all, 2, approved, moved)).toEqual([])
    expect(versionSet([...all, { id: 'b2', name: 'b2.png', version: 2 }], 2, approved, moved).map(f => f.id)).toEqual(['b2'])
    // the round it left from still lists it only when it is not the newest version — history stays honest
    expect(versionSet(all, 1, approved, moved).map(f => f.id)).toEqual(['b'])
    const item = {
      id: 'card', edit_round: 2, split_out: ['a'],
      final_files: [
        { id: 'a', name: 'a.png', url: 'https://m/a.png', mime: 'image/png', size: 1, version: 1, uploaded_at: 'x' },
        { id: 'b2', name: 'b2.png', url: 'https://m/b2.png', mime: 'image/png', size: 1, version: 2, uploaded_at: 'x' },
      ],
      clip_approvals: [{ file_id: 'a', name: 'a.png', at: 'x', by: 'Jerry' }],
    }
    expect(sharedFilesOf(item, []).map(f => f.id)).toEqual(['b2'])
  })
  it('the send-back hooks it in, best-effort, and the new card is ready to hand over', () => {
    const route = readFileSync('app/api/production/items/[id]/transition/route.ts', 'utf8')
    expect(route).toContain("if (['client_review', 'client_changes_requested'].includes(String(item.status)) && SENT_BACK_STATUSES.includes(to)) {")
    expect(route).toContain('try { await splitApprovedClips(user, updated as never) } catch (e) {')
    // …and the Send back button's own route, which is the one the card actually uses
    const sendBack = readFileSync('app/api/production/items/[id]/send-back/route.ts', 'utf8')
    expect(sendBack).toContain("if (['client_review', 'client_changes_requested'].includes(String(item.status))) {")
    expect(sendBack).toContain('try { await splitApprovedClips(user, { ...item, ...current, status: current.status } as never) } catch (e) {')
    const split = readFileSync('app/lib/split-approved.ts', 'utf8')
    expect(split).toContain("status: 'approved_for_scheduling',")
    expect(split).toContain('accepted_at: now,')
    expect(split).toContain('split_from: item.id,')
    expect(split).toContain('if (handoff.length === 0 || remaining.length === 0) return null')
    expect(split).toContain("eventType: 'approved_clips_split'")
    expect(split).toContain("split_out: [...movedIdSet(item as never), ...handoff.map(f => f.id)],")
  })
})

describe('the hand-over carries the files to the scheduler (17 Sep 2026)', () => {
  it('the email names the files on a card of files, and the scheduler\u2019s view draws the versions with the client\u2019s ticks', () => {
    const workflow = readFileSync('app/lib/workflow.ts', 'utf8')
    expect(workflow).toContain('<p><strong>The files are on the card:</strong> ')
    expect(workflow).toContain("'The files on the card are what you post from' : 'The folder below is what you work from'")
    const detail = readFileSync('app/dashboard/board/PostApprovalDetail.tsx', 'utf8')
    expect(detail).toContain('approvedIds={clipApprovalsOf(item as never).map(a => a.file_id)}')
    expect(detail).toMatch(/frozen=\{frozenCard\}\s*(\/\/[^\n]*\n\s*)*versions\s/)
  })
})

describe('the split reads in the card’s history (17 Sep 2026)', () => {
  it('both cards say what happened', async () => {
    const { describeCardActivity } = await import('../app/lib/card-history-core')
    const row = (action: string, detail: string) => ({ action, detail, actor_name: 'Akmal', created_at: 'x' }) as never
    expect(describeCardActivity(row('approved_clips_split', '1 approved clip moved'))?.text).toContain('Approved clips moved to a handover card by Akmal')
    expect(describeCardActivity(row('card_made_from_approved_clips', 'split from “X” at Version 2'))?.text).toContain('Made from the approved clips by Akmal')
  })
})
