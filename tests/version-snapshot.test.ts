import { describe, expect, it } from 'vitest'
import {
  finalFilesAsPulls, finalFilesAsVersionPulls, finalFilesOf, versionRoundsOf, versionSnapshot, withRetired, type FinalFile,
} from '../app/lib/final-files-core'
import { finishedVersionsOf } from '../app/lib/edit-round-core'
import { asClientVersions, assetLine, clipsAtRound, clientRoundsOf } from '../app/lib/editing-portal-core'
import { clientFrozenFor } from '../app/lib/edit-freeze-core'
import { approvedFilesVersion, cardVersionGroups } from '../app/lib/social-schedule-core'
import { clipApprovalsOf, withClipApproved } from '../app/lib/clip-approvals-core'
import { mergeDriveHandIn } from '../app/lib/drive-handin-core'
import type { PullFile } from '../app/lib/drive-pull-core'

/**
 * EVERY VERSION IS THE WHOLE SET (the owner, 30 Sep 2026): "anything that gets sent back is the whole version of the
 * files, so nothing is missed"; "in every step — client section, quality review — Version 1 all files, Version 2 all
 * files"; "even if the client approves all files, everything is saved". One function (final-files-core
 * versionSnapshot / snapshotOf) answers "what was Version N" for every screen.
 */

const f = (id: string, name: string, version: number, extra: Partial<FinalFile> = {}): FinalFile =>
  ({ id, name, url: `https://r2.test/${id}.mp4`, mime: 'video/mp4', size: 100, version, uploaded_at: `2026-09-2${version}T00:00:0${id.length % 10}.000Z`, by: 'u', ...extra })

// Version 1: three clips. Sent back with Script 2 named; Version 2 replaces Script 2 only.
// Version 3: Script 1 replaced, a new Script 4 added, Script 3 dropped.
const V1 = [f('s1', 'Script 1.mp4', 1), f('s2', 'Script 2.mp4', 1), f('s3', 'Script 3.mp4', 1)]
const V2 = [...V1, f('s2b', 'Script 2.mp4', 2, { asset_id: 's2', replaces: 's2' })]
const V3 = [...withRetired(V2, 's3', 3), f('s1c', 'Script 1.mp4', 3, { asset_id: 's1', replaces: 's1' }), f('s4', 'Script 4.mp4', 3)]
const ids = (list: readonly { id: string }[]) => list.map(x => x.id)

describe('the whole set at a version', () => {
  it('Version 1 is every file handed in', () => {
    expect(ids(versionSnapshot({ final_files: V1 }, 1))).toEqual(['s1', 's2', 's3'])
    expect(versionSnapshot({ final_files: V1 }, 1).every(x => x.changed)).toBe(true)
  })

  it('Version 2 after a partial send-back is ALL the files: the new cut in its slot, the others carried, each marked', () => {
    const snap = versionSnapshot({ final_files: V2 }, 2)
    expect(ids(snap)).toEqual(['s1', 's2b', 's3'])
    expect(snap.map(x => [x.id, x.changed, x.new_cut])).toEqual([['s1', false, false], ['s2b', true, true], ['s3', false, false]])
    // and Version 1 is still exactly what it was
    expect(ids(versionSnapshot({ final_files: V2 }, 1))).toEqual(['s1', 's2', 's3'])
  })

  it('Version 3: a replaced piece, a new piece, a dropped piece — every earlier version intact', () => {
    const card = { final_files: V3 }
    expect(versionRoundsOf(card)).toEqual([3, 2, 1])
    const v3 = versionSnapshot(card, 3)
    expect(ids(v3)).toEqual(['s1c', 's2b', 's4'])
    expect(v3.map(x => [x.id, x.changed, x.new_cut])).toEqual([['s1c', true, true], ['s2b', false, false], ['s4', true, false]])
    expect(ids(versionSnapshot(card, 2))).toEqual(['s1', 's2b', 's3'])
    expect(ids(versionSnapshot(card, 1))).toEqual(['s1', 's2', 's3'])
  })

  it('a Drive-handed Version 2 on a files-only card is the whole set too', () => {
    const copy: PullFile = { id: 'driveS2abcdef', name: 'Script 2.mp4', mime: 'video/mp4', size: 500, done: 500, url: 'https://r2.test/pulls/s2.mp4', status: 'done', version: 2, modified: 'm' }
    const card = { status: 'client_changes_requested', change_assets: ['s2'], final_files: V1 }
    const r = mergeDriveHandIn(V1, [copy], { drive_ids: ['driveS2abcdef'], map: { driveS2abcdef: 's2' }, round: 2, by: 'u' }, card, 2, '2026-09-30T00:00:00.000Z')
    if (!r.ok) throw new Error(r.error)
    const snap = versionSnapshot({ final_files: r.files }, 2)
    expect(snap.map(x => [x.name, x.changed, x.drive_file_id ?? null])).toEqual([['Script 1.mp4', false, null], ['Script 2.mp4', true, 'driveS2abcdef'], ['Script 3.mp4', false, null]])
  })
})

describe('every screen reads that one answer', () => {
  it('the team’s version tabs (quality review, card page, manager views): BEFORE, Version 2 held only the changed file; NOW the whole set', () => {
    const rows = (files: unknown[]) => [{ id: 'uploads', kind: 'item', scope_id: 'c', folder_id: 'uploads', folder_url: '', status: 'done', purpose: 'finished', files, started_at: '' }]
    const opts = { itemId: 'c', finishedFolderId: null, filesOf: (r: { files?: unknown }) => r.files as PullFile[], currentRound: 2 }
    const before = finishedVersionsOf(rows(finalFilesAsPulls({ final_files: V2 })), opts)
    expect(before.map(t => [t.round, ids(t.files)])).toEqual([[2, ['s2b']], [1, ['s1', 's2', 's3']]])     // what was drawn until today
    const now = finishedVersionsOf(rows(finalFilesAsVersionPulls({ final_files: V2 })), opts)
    expect(now.map(t => [t.round, ids(t.files)])).toEqual([[2, ['s1', 's2b', 's3']], [1, ['s1', 's2', 's3']]])
    expect((now[0].files as unknown as { id: string; changed: boolean; from_version: number }[]).map(x => [x.id, x.changed, x.from_version]))
      .toEqual([['s1', false, 1], ['s2b', true, 2], ['s3', false, 1]])
  })

  it('the client portal: each of their versions is the whole set, with "Before" on the replaced piece', () => {
    const card = { final_files: V3, client_rounds: [1, 2, 3] }
    const clips = finalFilesOf(card).map(x => ({ id: x.id, version: x.version, asset_id: x.asset_id ?? x.id, carries: true, retired_round: x.retired_round ?? null }))
    const client = asClientVersions(clips, clientRoundsOf(card))
    for (const r of [1, 2, 3]) expect(ids(clipsAtRound(client, r))).toEqual(ids(versionSnapshot(card, r)))
    expect(ids(assetLine(client, clipsAtRound(client, 3)[0]))).toEqual(['s1c', 's1'])
  })

  it('what the client is frozen with at a send is the whole set', () => {
    expect(clientFrozenFor({ final_files: V2, edit_round: 2 }, 'now').files.map(x => x.id)).toEqual(['s1', 's2b', 's3'])
  })

  it('the post picker’s versions are the same sets', () => {
    const groups = cardVersionGroups({ final_files: V3, status: 'approved_for_scheduling' } as never, [])
    expect(groups.map(g => g.slides.map(s => s.url.replace('https://r2.test/', '').replace('.mp4', ''))))
      .toEqual([['s1c', 's2b', 's4'], ['s1', 's2b', 's3'], ['s1', 's2', 's3']])
  })
})

describe('the client approves everything — and everything is kept', () => {
  it('approve all: the approved version is the whole set; V1..V3 are all still there with their comments', () => {
    let approvals = clipApprovalsOf({ clip_approvals: [] })
    const card = { final_files: V3, edit_round: 3, status: 'client_review', clip_approvals: approvals }
    for (const x of versionSnapshot(card, 3)) approvals = withClipApproved(approvals, { file_id: x.id, name: x.name, at: 't', by: 'Client' } as never)
    const approved = { ...card, status: 'approved_for_scheduling', clip_approvals: approvals }
    // approving touches only the ticks: the files, every version of them, untouched
    expect(approved.final_files).toBe(V3)
    expect(((approvedFilesVersion(approved as never)!.files) as { url: string }[]).map(s => s.url)).toEqual(versionSnapshot(approved, 3).map(x => x.url))
    expect(approvals.map(a => a.file_id).sort()).toEqual(['s1c', 's2b', 's4'])
    // comments were written on V1's Script 2 and V2's Script 1 — both files are still in their versions
    const comments = [{ video_file_id: 's2', body: 'shorter' }, { video_file_id: 's1', body: 'music' }]
    expect(ids(versionSnapshot(approved, 1))).toContain(comments[0].video_file_id)
    expect(ids(versionSnapshot(approved, 2))).toContain(comments[1].video_file_id)
    expect(versionRoundsOf(approved)).toEqual([3, 2, 1])
  })
})
