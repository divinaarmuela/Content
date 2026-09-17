import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { approvedIdSet, carriedInto, carriedWords, versionProgress, versionSet } from '../app/lib/version-approval-core'
import { sharedFilesOf } from '../app/lib/share-link-core'

const all = [
  { id: 'a', name: 'a.mov', version: 1 },
  { id: 'b', name: 'b.mov', version: 1 },
  { id: 'c', name: 'c.mov', version: 1 },
  { id: 'b', name: 'b.mov', version: 2 },     // b handed in again in version 2 — the new one stands
  { id: 'd', name: 'd.mov', version: 2 },
  { id: 'e', name: 'e.mov', version: 3 },
]

describe('version-approval-core — approved clips carry forward (17 Sep 2026)', () => {
  it('carries an approved clip into a later version once, from its latest round, unless that version hands it in again', () => {
    const approved = approvedIdSet([{ file_id: 'a' }, { file_id: 'b' }])
    expect(carriedInto(all, 2, approved).map(f => `${f.id}@${f.carried_from}`)).toEqual(['a@1'])
    expect(carriedInto(all, 3, approved).map(f => `${f.id}@${f.carried_from}`)).toEqual(['b@2', 'a@1'])
    expect(carriedInto(all, 1, approved)).toEqual([])
    expect(carriedInto(all, 2, new Set())).toEqual([])
    expect(versionSet(all, 3, approved).map(f => f.id)).toEqual(['b', 'a', 'e'])
  })
  it('counts the version over its own clips and the carried ones, and says when it is good to go', () => {
    const approved = approvedIdSet([{ file_id: 'a' }, { file_id: 'b' }])
    const v3 = versionSet(all, 3, approved)
    expect(versionProgress(v3, approved)).toEqual({ approved: 2, total: 3, carried: 2, allApproved: false, words: '2 of 3 clips approved by the client · 1 still to review · 2 carried over from an earlier version' })
    expect(versionProgress(v3, approvedIdSet([{ file_id: 'a' }, { file_id: 'b' }, { file_id: 'e' }])).words).toBe('All 3 clips approved by the client — this version is good to go · 2 carried over from an earlier version')
    expect(versionProgress([{ id: 'x' }], new Set())).toEqual({ approved: 0, total: 1, carried: 0, allApproved: false, words: null })
    expect(versionProgress([], new Set()).words).toBeNull()
    expect(carriedWords(1)).toBe('Approved in Version 1 — carried over')
    expect(carriedWords(null)).toBeNull()
  })
  it('the share link hands out the accepted version with what it carries', () => {
    const item = {
      id: 'card', edit_round: 2,
      final_files: [
        { id: 'p1', name: 'p1.png', url: 'https://m/p1.png', mime: 'image/png', size: 1, version: 1, uploaded_at: 'x' },
        { id: 'p2', name: 'p2.png', url: 'https://m/p2.png', mime: 'image/png', size: 1, version: 1, uploaded_at: 'x' },
        { id: 'p3', name: 'p3.png', url: 'https://m/p3.png', mime: 'image/png', size: 1, version: 2, uploaded_at: 'x' },
      ],
      clip_approvals: [{ file_id: 'p1', name: 'p1.png', at: 'x', by: 'Jerry' }],
    }
    expect(sharedFilesOf(item, []).map(f => f.id)).toEqual(['p1', 'p3'])
  })
  it('the portal, the card and the share link read the same rule', () => {
    const portal = readFileSync('app/lib/editing-portal.ts', 'utf8')
    expect(portal).toContain('const carried = carriedInto(list, latest, approvedIdSet(clipApprovalsOf(item))).map(c => ({ ...c, version: latest }))')
    expect(portal).toContain('clips: shown,')
    const review = readFileSync('app/components/portal/EditingReview.tsx', 'utf8')
    expect(review).toContain('{carriedWords(clip.carried_from) && <p')
    const box = readFileSync('app/dashboard/board/FilesToWorkFrom.tsx', 'utf8')
    expect(box).toContain('const carried = shownVersion ? carriedInto(allFinished, shownVersion.round, approvedSet).map(f => ({ ...f, version: shownVersion.round })) : []')
    expect(box).toContain('copies={versionFiles}')
    expect(box).toContain('data-version-progress')
    const share = readFileSync('app/lib/share-link-core.ts', 'utf8')
    expect(share).toContain('return versionSet([...uploaded, ...copied], round, approvedIdSet(clipApprovalsOf(item)))')
  })
})

describe('the portal header counts the latest version (17 Sep 2026)', () => {
  it('says how many clips are in the version being reviewed, not across every version', () => {
    const page = readFileSync('app/portal/[token]/edit/[id]/page.tsx', 'utf8')
    expect(page).toContain("const n = data.clips.filter(c => c.version === (data.rounds[0] ?? data.round)).length")
  })
})
