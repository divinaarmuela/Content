import { describe, expect, it } from 'vitest'
import { driveWatchChanges, driveWatchNote, mergeDriveHandIn, watchedHandIn, type DriveHandIn } from '../app/lib/drive-handin-core'

const now = Date.parse('2026-10-21T03:00:00Z')
const done = (over: Partial<DriveHandIn> = {}): DriveHandIn => ({
  id: 'h1', pull_id: 'p1', link: 'https://drive.google.com/drive/folders/F', drive_ids: ['a'], round: 1, by: 'ed',
  requested_at: '2026-10-21T01:00:00Z', status: 'done', settled_at: '2026-10-21T01:01:00Z', settled_round: 1, whole: true, ...over,
})
const file = (id: string, drive: string, name: string, extra: Record<string, unknown> = {}) =>
  ({ id, url: `https://r2/${id}`, name, version: 1, asset_id: id, drive_file_id: drive, drive_md5: `md5-${drive}`, source: 'drive', ...extra })

describe('the Drive link is checked every minute until the quality check passes (the owner, 21 Oct 2026)', () => {
  it('watches a card being made and at the quality check', () => {
    for (const status of ['draft_uploaded', 'revision_required', 'quality_check']) {
      expect(watchedHandIn({ status, edit_round: 1, drive_handins: [done()] }, now)?.id).toBe('h1')
    }
  })
  it('stops once it passes the quality check — colour grade, the client, approved', () => {
    for (const status of ['colour_grade', 'client_review', 'approved_for_scheduling', 'scheduled']) {
      expect(watchedHandIn({ status, edit_round: 1, drive_handins: [done()] }, now)).toBeNull()
    }
  })
  it('waits while a copy is running, and after a failed automatic copy waits 15 minutes', () => {
    expect(watchedHandIn({ status: 'draft_uploaded', drive_handins: [done(), done({ id: 'h2', status: 'copying' })] }, now)).toBeNull()
    const failed = done({ id: 'h2', status: 'failed', auto: true, settled_at: new Date(now - 5 * 60_000).toISOString() })
    expect(watchedHandIn({ status: 'draft_uploaded', drive_handins: [done(), failed] }, now)).toBeNull()
    const old = { ...failed, settled_at: new Date(now - 20 * 60_000).toISOString() }
    expect(watchedHandIn({ status: 'draft_uploaded', drive_handins: [done(), old] }, now)?.id).toBe('h1')
  })
  it('does not watch a hand-in where the editor picked only some files — the rest were left out on purpose', () => {
    expect(watchedHandIn({ status: 'quality_check', edit_round: 1, drive_handins: [done({ whole: undefined })] }, now)).toBeNull()
  })
  it('does not watch a card with no Drive hand-in', () => {
    expect(watchedHandIn({ status: 'draft_uploaded', drive_handins: [] }, now)).toBeNull()
  })
})

describe('what counts as a change', () => {
  const item = { final_files: [file('f1', 'a', 'Script 1.mp4'), file('f2', 'b', 'Script 2.mp4')] }
  it('a new file in the folder is added', () => {
    const d = driveWatchChanges(item, [
      { id: 'a', name: 'Script 1.mp4', mime: 'video/mp4', md5: 'md5-a' },
      { id: 'b', name: 'Script 2.mp4', mime: 'video/mp4', md5: 'md5-b' },
      { id: 'c', name: 'More/Script 3.mp4', mime: 'video/mp4', md5: 'md5-c' },
    ])
    expect(d).toMatchObject({ changed: true, added: ['c'], updated: [], missing: [] })
  })
  it('a re-exported file (same Drive file, new checksum) is a change', () => {
    const d = driveWatchChanges(item, [
      { id: 'a', name: 'Script 1.mp4', mime: 'video/mp4', md5: 'NEW' },
      { id: 'b', name: 'Script 2.mp4', mime: 'video/mp4', md5: 'md5-b' },
    ])
    expect(d).toMatchObject({ changed: true, updated: ['a'] })
  })
  it('nothing new is no change — and without proof from Drive it is never copied again every minute', () => {
    expect(driveWatchChanges(item, [
      { id: 'a', name: 'Script 1.mp4', mime: 'video/mp4', md5: 'md5-a' },
      { id: 'b', name: 'Script 2.mp4', mime: 'video/mp4' },
    ]).changed).toBe(false)
  })
  it('a file gone from the folder is noted, not a change', () => {
    const d = driveWatchChanges(item, [{ id: 'a', name: 'Script 1.mp4', mime: 'video/mp4', md5: 'md5-a' }])
    expect(d.changed).toBe(false)
    expect(d.missing).toEqual([{ asset: 'f2', name: 'Script 2.mp4' }])
    expect(driveWatchNote({ missing: d.missing })).toContain('Script 2.mp4 is no longer in the Drive folder — kept on the card')
    expect(driveWatchNote({ missing: [] })).toBeNull()
  })
})

describe('an automatic copy never takes a piece off the card', () => {
  it('keeps the piece gone from the folder, adds the new one', () => {
    const list = [file('f1', 'a', 'Script 1.mp4'), file('f2', 'b', 'Script 2.mp4')] as never[]
    const pulled = [
      { id: 'a', name: 'Script 1.mp4', mime: 'video/mp4', size: 1, done: 1, status: 'done', url: 'https://r2/f1', md5: 'md5-a' },
      { id: 'c', name: 'Script 3.mp4', mime: 'video/mp4', size: 1, done: 1, status: 'done', url: 'https://r2/new-c', md5: 'md5-c' },
    ] as never[]
    const base = { drive_ids: ['a', 'c'], round: 1, by: 'ed', whole: true }
    const auto = mergeDriveHandIn(list, pulled, { ...base, auto: true }, { status: 'draft_uploaded', final_files: list }, 1, '2026-10-21T03:00:00Z')
    expect(auto.ok && auto.retired).toEqual([])
    expect(auto.ok && auto.fresh?.length).toBe(1)
    const byHand = mergeDriveHandIn(list, pulled, base, { status: 'draft_uploaded', final_files: list }, 1, '2026-10-21T03:00:00Z')
    expect(byHand.ok && byHand.retired).toEqual(['f2'])
  })
})
