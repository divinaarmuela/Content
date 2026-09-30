import { describe, expect, it } from 'vitest'
import {
  NOT_SHARED_WORDS, copyFor, defaultMap, driveLinkTarget, handInPullId, handInRefusal, handInWords, mergeDriveHandIn, sanitiseMap, sanitisePicked,
} from '../app/lib/drive-handin-core'
import { sanitiseFinalFiles, type FinalFile } from '../app/lib/final-files-core'
import type { PullFile } from '../app/lib/drive-pull-core'

/** A version handed in from Drive — the pure rules (drive-handin-core.ts). */

const ID = '1AbCdEfGhIjKlMnOp'

describe('the Drive id in a pasted link', () => {
  it.each([
    [`https://drive.google.com/file/d/${ID}/view?usp=sharing`, 'file'],
    [`https://drive.google.com/file/d/${ID}`, 'file'],
    [`https://drive.google.com/drive/folders/${ID}`, 'folder'],
    [`https://drive.google.com/drive/u/0/folders/${ID}?usp=drive_link`, 'folder'],
    [`https://drive.google.com/open?id=${ID}`, 'file'],
    [`https://drive.google.com/uc?id=${ID}&export=download`, 'file'],
    [`https://docs.google.com/uc?export=download&id=${ID}`, 'file'],
  ])('%s → %s', (url, kind) => {
    expect(driveLinkTarget(url)).toMatchObject({ ok: true, id: ID, kind })
  })

  it.each([
    ['', 'Paste the Google Drive link first'],
    ['not a link', 'That does not look like a link'],
    [`http://drive.google.com/file/d/${ID}`, 'That is not a Google Drive link'],
    [`https://evil.example/drive.google.com/file/d/${ID}`, 'That is not a Google Drive link'],
    ['https://www.dropbox.com/s/abc/reel.mp4', 'That is not a Google Drive link'],
    ['https://drive.google.com/drive/my-drive', 'That Drive link does not name a file or a folder'],
  ])('refuses %j', (url, words) => {
    const r = driveLinkTarget(url)
    expect(r.ok).toBe(false)
    expect((r as { error: string }).error).toContain(words)
  })

  it('a hand-in row never shares an id with the folder-to-work-from row', () => {
    expect(handInPullId(ID, 'card-1')).toBe(`handin-${ID}@card-1`)
    expect(handInPullId(ID, 'card-1')).not.toBe(`folder-${ID}@card-1`)
  })
})

describe('what may be picked', () => {
  const listed = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  it('keeps the order, drops repeats, refuses what the listing does not hold', () => {
    expect(sanitisePicked(['c', 'a', 'c'], listed)).toEqual({ ok: true, ids: ['c', 'a'] })
    expect(sanitisePicked(['z'], listed).ok).toBe(false)
    expect(sanitisePicked([], listed).ok).toBe(false)
  })
  it('a map names only pieces on the card now, or new', () => {
    const item = { final_files: [{ id: 'p1', name: 'x', url: 'https://r/x', mime: '', size: 1, version: 1, uploaded_at: 't' }] }
    expect(sanitiseMap({ a: 'p1', b: 'nope', c: 'new' }, ['a', 'b', 'c'], item)).toEqual({ a: 'p1', c: 'new' })
  })
})

describe('who may start one', () => {
  it('never onto approved work; a manager only while the check or the client is looking', () => {
    for (const s of ['approved_for_scheduling', 'scheduled', 'published']) expect(handInRefusal({ status: s }, true)).toMatch(/approved/)
    for (const s of ['quality_check', 'client_review']) {
      expect(handInRefusal({ status: s }, false)).toMatch(/only a manager/)
      expect(handInRefusal({ status: s }, true)).toBeNull()
    }
    for (const s of ['draft_uploaded', 'in_progress', 'revision_required', 'client_changes_requested']) expect(handInRefusal({ status: s }, false)).toBeNull()
  })
})

const up = (id: string, name: string, version: number, extra: Partial<FinalFile> = {}): FinalFile =>
  ({ id, name, url: `https://r2.test/${id}`, mime: 'video/mp4', size: 100, version, uploaded_at: `2026-09-2${version}T00:00:00.000Z`, by: 'u', ...extra })
const copy = (id: string, name: string, extra: Partial<PullFile> = {}): PullFile =>
  ({ id, name, mime: 'video/mp4', size: 500, done: 500, url: `https://r2.test/pulls/${id}`, status: 'done', version: 2, modified: 'm2', ...extra })

describe('the hand-in onto the card', () => {
  const now = '2026-09-30T10:00:00.000Z'
  it('new pieces keep the editor’s order and their Drive ids', () => {
    const r = mergeDriveHandIn([], [copy('d1', 'B.mp4'), copy('d2', 'A.mp4')], { drive_ids: ['d2', 'd1'], round: 1, by: 'u' }, { status: 'in_progress' }, 1, now)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.files.map(f => [f.name, f.drive_file_id, f.source, f.version])).toEqual([['A.mp4', 'd2', 'drive', 1], ['B.mp4', 'd1', 'drive', 1]])
  })

  it('a subfolder file takes its own name, not the folder path', () => {
    const r = mergeDriveHandIn([], [copy('d1', 'Finals/Reel.mp4')], { drive_ids: ['d1'], round: 1, by: 'u' }, { status: 'in_progress' }, 1, now)
    expect(r.ok && r.files[0].name).toBe('Reel.mp4')
  })

  it('all or nothing: a missing or failed copy names the file and adds nothing', () => {
    const r = mergeDriveHandIn([up('p1', 'A.mp4', 1)], [copy('d1', 'A.mp4', { status: 'failed', error: 'Drive stopped' })], { drive_ids: ['d1', 'd9'], names: { d9: 'Lost.mp4' }, round: 2, by: 'u' }, { status: 'revision_required' }, 2, now)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.failed).toEqual(['d1', 'd9'])
    expect(r.error).toContain('A.mp4, Lost.mp4')
    expect(r.error).toContain('Drive stopped')
  })

  it('in the same round, a changed Drive file replaces its own piece ("Replace again"), an unchanged one is carried', () => {
    const list = [up('p1', 'A.mp4', 1, { drive_file_id: 'd1', drive_modified: 'm1', source: 'drive' }), up('p2', 'B.mp4', 1, { drive_file_id: 'd2', drive_modified: 'm2', source: 'drive' })]
    const r = mergeDriveHandIn(list, [copy('d1', 'A.mp4', { version: 1 }), copy('d2', 'B.mp4', { version: 1 })], { drive_ids: ['d1', 'd2'], round: 1, by: 'u' }, { status: 'in_progress', final_files: list }, 1, now)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.carried).toEqual(['d2'])
    expect(r.files).toHaveLength(3)
    expect(r.files[2]).toMatchObject({ asset_id: 'p1', replaces: 'p1', version: 1, drive_file_id: 'd1' })
  })

  it('an explicit "new" makes a new piece even when the name matches', () => {
    const list = [up('p1', 'A.mp4', 1)]
    const r = mergeDriveHandIn(list, [copy('d1', 'A.mp4')], { drive_ids: ['d1'], map: { d1: 'new' }, round: 2, by: 'u' }, { status: 'revision_required', final_files: list }, 2, now)
    expect(r.ok && r.files.map(f => f.asset_id ?? f.id)).toEqual(['p1', r.ok ? r.added[0] : ''])
  })

  it('a piece from an earlier version changes only when the rules say (sent back and named, or a manager while the client looks)', () => {
    const list = [up('p1', 'A.mp4', 1)]
    const hi = (manager: boolean) => ({ drive_ids: ['d1'], round: 2, by: 'u', manager })
    // not sent back, not a manager: left as it is, said why
    const plain = mergeDriveHandIn(list, [copy('d1', 'A.mp4')], hi(false), { status: 'in_progress', final_files: list }, 2, now)
    expect(plain.ok && plain.skipped).toEqual([{ drive_id: 'd1', why: 'A.mp4 was not asked to change — it stays as it is' }])
    // a manager while the client is looking (mayReplaceAsset's rule)
    const mgr = mergeDriveHandIn(list, [copy('d1', 'A.mp4')], hi(true), { status: 'client_review', final_files: list }, 2, now)
    expect(mgr.ok && mgr.files[1]).toMatchObject({ asset_id: 'p1', replaces: 'p1', version: 2 })
    // sent back with the piece named
    const named = mergeDriveHandIn(list, [copy('d1', 'A.mp4')], hi(false), { status: 'revision_required', change_assets: ['p1'], final_files: list }, 2, now)
    expect(named.ok && named.added).toHaveLength(1)
  })
})

describe('the popup’s guess at which piece each Drive file is', () => {
  it('same Drive id, then same name, then the pieces the send-back named, else new', () => {
    const item = {
      status: 'client_changes_requested',
      change_assets: ['p3'],
      final_files: [up('p1', 'Intro.mp4', 1, { drive_file_id: 'd1' }), up('p2', 'Script 2.mp4', 1), up('p3', 'Old name.mp4', 1)],
    }
    expect(defaultMap([{ id: 'd1', name: 'Intro renamed.mp4' }, { id: 'dx', name: 'script_2.mp4' }, { id: 'dy', name: 'Brand new.mp4' }, { id: 'dz', name: 'Other.mp4' }], item))
      .toEqual({ d1: 'p1', dx: 'p2', dy: 'p3', dz: 'new' })
  })
})

describe('the line on the card', () => {
  const h = { id: 'h1', pull_id: 'p', link: 'l', drive_ids: ['a', 'b', 'c'], round: 2, by: 'u', requested_at: 't', status: 'copying' as const }
  it('counts only the picked files: "Copying 2 of 3 from Google Drive…"', () => {
    const row = { id: 'p', folder_id: 'f', folder_url: 'u', kind: 'item', scope_id: 'c', status: 'copying', total_files: 3, total_bytes: 0, done_files: 1, done_bytes: 0, started_at: new Date(0).toISOString(),
      files: [copy('a', 'A', { version: 2 }), copy('b', 'B', { status: 'copying', done: 100, url: null, version: 2 }), copy('c', 'C', { status: 'waiting', done: 0, url: null, version: 2 })] }
    expect(handInWords(row, h, 10_000)!.words).toMatch(/^Copying 2 of 3 from Google Drive…/)
  })
  it('an unreadable link says the owner’s words; done and failed say what happened', () => {
    expect(handInWords({ status: 'unreadable' } as never, h, 0)!.words).toBe(NOT_SHARED_WORDS)
    expect(handInWords(null, { ...h, status: 'done', file_ids: ['x', 'y'], carried: ['c'] }, 0)!.words).toBe('Handed in from Drive: 2 files · 1 unchanged, kept as they were')
    expect(handInWords(null, { ...h, status: 'failed', error: 'Nothing was handed in — X' }, 0)).toEqual({ tone: 'failed', words: 'Nothing was handed in — X' })
  })
  it('copyFor prefers the copy tagged with the hand-in’s round', () => {
    expect(copyFor([copy('a', 'A', { version: 1, url: 'https://r/1' }), copy('a', 'A', { version: 2, url: 'https://r/2' })], 'a', 2)!.url).toBe('https://r/2')
  })
})

describe('a later save of the file list keeps where each file came from', () => {
  it('sanitiseFinalFiles keeps source, drive_file_id and drive_modified', () => {
    const r = sanitiseFinalFiles([up('p1', 'A.mp4', 1, { source: 'drive', drive_file_id: 'driveFile0001', drive_modified: 'm1' })], { status: 'in_progress' }, 'u', 'now')
    expect(r.ok && r.files[0]).toMatchObject({ source: 'drive', drive_file_id: 'driveFile0001', drive_modified: 'm1' })
  })
  it('and still drops junk in those fields', () => {
    const r = sanitiseFinalFiles([up('p1', 'A.mp4', 1, { source: 'ftp' as never, drive_file_id: 'bad id!' })], { status: 'in_progress' }, 'u', 'now')
    expect(r.ok && r.files[0]).not.toHaveProperty('drive_file_id')
    expect(r.ok && r.files[0]).not.toHaveProperty('source')
  })
})
