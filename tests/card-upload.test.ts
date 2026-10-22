import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DIRECT_CHUNK, PROXY_CHUNK, RESUME_FOR_MS, cardFilingAllowed, folderNameOf, isVersionFolderName, resumableMatch, sharingUrl, uniqueName, versionFolderName,
} from '@/app/lib/card-upload-core'
import { TEST_CLIENT_IDS } from '@/app/lib/test-clients-core'

// the owner, 22 Oct 2026: editors upload straight into Clients / {Client} / {Card} / V{n} in Drive — preview first
describe('the switch', () => {
  afterEach(() => { delete process.env.DRIVE_CARD_FILING })
  it('is on for the test clients only, until it is "all"', () => {
    expect(cardFilingAllowed(TEST_CLIENT_IDS[0])).toBe(true)
    expect(cardFilingAllowed('a-real-client')).toBe(false)
    expect(cardFilingAllowed(null)).toBe(false)
    process.env.DRIVE_CARD_FILING = '1'
    expect(cardFilingAllowed('a-real-client')).toBe(false)
    process.env.DRIVE_CARD_FILING = 'all'
    expect(cardFilingAllowed('a-real-client')).toBe(true)
  })
})

describe('names and links', () => {
  it('a second card with the same title gets its own folder', () => {
    expect(uniqueName('Travel Vlogs', [])).toBe('Travel Vlogs')
    expect(uniqueName('Travel Vlogs', ['travel vlogs'])).toBe('Travel Vlogs (2)')
    expect(uniqueName('Travel Vlogs', ['Travel Vlogs', 'Travel Vlogs (2)'])).toBe('Travel Vlogs (3)')
  })
  it('a folder name has no slashes or control characters, and is never empty', () => {
    expect(folderNameOf('Reels / Stories', 'x')).toBe('Reels - Stories')
    expect(folderNameOf('  ', 'Card')).toBe('Card')
    expect(folderNameOf('a\u0000b', 'x')).toBe('ab')
  })
  it('V1, V2 … are the versions', () => {
    expect(versionFolderName(2)).toBe('V2')
    expect(versionFolderName(0)).toBe('V1')
    expect(isVersionFolderName('V3')).toBe(true)
    expect(isVersionFolderName('Reels')).toBe(false)
  })
  it('the link anyone can view', () => {
    expect(sharingUrl('abc123')).toBe('https://drive.google.com/drive/folders/abc123?usp=sharing')
  })
  it('pieces Google accepts: multiples of 256 KB, the server ones under 4.5 MB', () => {
    expect(DIRECT_CHUNK % (256 * 1024)).toBe(0)
    expect(PROXY_CHUNK % (256 * 1024)).toBe(0)
    expect(PROXY_CHUNK).toBeLessThan(4.5 * 1024 * 1024)
  })
})

describe('carrying on tomorrow', () => {
  const now = Date.parse('2026-10-23T09:00:00.000Z')
  const row = { purpose: 'card', item_id: 'i', parent_id: 'p', name: 'Cut.mp4', size: 100, status: 'open', created_by: 'ed@x', created_at: '2026-10-22T18:00:00.000Z' }
  const want = { itemId: 'i', parentId: 'p', name: 'Cut.mp4', size: 100, by: 'ed@x' }
  it('the same file, same place, same person, picked again the next day, carries on', () => {
    expect(resumableMatch(row, want, now)).toBe(true)
  })
  it('anything different starts fresh', () => {
    expect(resumableMatch({ ...row, size: 101 }, want, now)).toBe(false)
    expect(resumableMatch({ ...row, created_by: 'someone@else' }, want, now)).toBe(false)
    expect(resumableMatch({ ...row, status: 'done' }, want, now)).toBe(false)
    expect(resumableMatch({ ...row, purpose: null }, want, now)).toBe(false)
    expect(resumableMatch(row, want, Date.parse(row.created_at) + RESUME_FOR_MS + 1)).toBe(false)
  })
})

// every exported function in card-upload.ts that can write to Drive checks the switch first (trap 13)
describe('the guard is in the source', () => {
  const WRITERS = ['ensureCardFolders', 'startCardUpload', 'finishCardUploads', 'makeCardFolder', 'renameCardFolder']
  const READS = ['cardFolderTree', 'cardUploadState', 'cardUploadRow']
  it('every writer checks cardFilingAllowed, and nothing new is unclassified', () => {
    const src = readFileSync('app/lib/card-upload.ts', 'utf8')
    const found = [...src.matchAll(/^export (?:async )?function (\w+)/gm)].map(m => ({ name: m[1], at: m.index! }))
    const body = (i: number) => src.slice(found[i].at, found[i + 1]?.at ?? src.length)
    for (const [i, f] of found.entries()) {
      expect(WRITERS.includes(f.name) || READS.includes(f.name), `classify ${f.name}`).toBe(true)
      if (WRITERS.includes(f.name)) expect(body(i).includes('cardFilingAllowed('), `${f.name} skips the switch`).toBe(true)
    }
  })
})

// the owner, 22 Oct 2026: "we can enter files at any given time"; "to replace a version we pick the file and put the
// new version with it"; "make sure we have timeline of when the files added"
describe('any time, and Replace', () => {
  const now = '2026-10-22T10:00:00.000Z'
  const up = (id: string, name: string, version: number, extra: Record<string, unknown> = {}) =>
    ({ id, name, url: `https://r2/${id}`, mime: 'video/mp4', size: 10, version, uploaded_at: '2026-10-20T00:00:00.000Z', by: 'u', ...extra })
  const copy = (id: string, name: string) =>
    ({ id, name, status: 'done', url: `https://r2/copy-${id}`, mime: 'video/mp4', size: 20, version: 1 })

  it('a file picked with Replace is that piece’s new version, even on an approved card', async () => {
    const { mergeDriveHandIn } = await import('@/app/lib/drive-handin-core')
    const list = [up('a1', 'Reel A.mp4', 1), up('b1', 'Reel B.mp4', 1)]
    const card = { status: 'approved_for_scheduling', final_files: list }
    const r = mergeDriveHandIn(list as never, [copy('d1', 'Reel A final.mp4')] as never,
      { drive_ids: ['d1'], map: { d1: 'a1' }, round: 1, by: 'u', manager: true, any_time: true }, card, 1, now)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const fresh = r.files.find(f => f.name === 'Reel A final.mp4')!
    expect(fresh.asset_id).toBe('a1')
    expect(fresh.replaces).toBe('a1')
    expect(fresh.uploaded_at).toBe(now)
    // the earlier cut stays — the file's timeline
    expect(r.files.some(f => f.id === 'a1')).toBe(true)
  })

  it('without any_time the old rule stands: a piece not asked to change is left alone', async () => {
    const { mergeDriveHandIn } = await import('@/app/lib/drive-handin-core')
    const list = [up('a1', 'Reel A.mp4', 1)]
    const r = mergeDriveHandIn(list as never, [copy('d1', 'Reel A final.mp4')] as never,
      { drive_ids: ['d1'], map: { d1: 'a1' }, round: 2, by: 'u' }, { status: 'in_progress', final_files: list }, 2, now)
    expect(r.ok && r.added.length).toBe(0)
  })

  it('the approved-card refusal is lifted for these uploads only; an earlier version is still never rewritten', async () => {
    const { finalFilesChangeRefusal } = await import('@/app/lib/final-files-core')
    const before = [up('a1', 'A.mp4', 1)] as never[]
    const after = [...before, up('a2', 'A2.mp4', 1, { asset_id: 'a1', replaces: 'a1' })] as never[]
    const card = { status: 'approved_for_scheduling', edit_round: 1 }
    expect(finalFilesChangeRefusal(before, after, card, false)).toMatch(/approved/)
    expect(finalFilesChangeRefusal(before, after, card, false, true)).toBeNull()
    expect(finalFilesChangeRefusal(before, [], { status: 'in_progress', edit_round: 2 }, true, true)).toMatch(/earlier version/)
  })

  it('a half-sent replacement carries on only for the same piece', () => {
    const row = { purpose: 'card', status: 'open', item_id: 'i', parent_id: 'p', name: 'A.mp4', size: 5, created_by: 'e', created_at: now, replaces: 'a1' }
    const want = { itemId: 'i', parentId: 'p', name: 'A.mp4', size: 5, by: 'e' }
    expect(resumableMatch(row, { ...want, replaces: 'a1' }, Date.parse(now))).toBe(true)
    expect(resumableMatch(row, { ...want, replaces: null }, Date.parse(now))).toBe(false)
    expect(resumableMatch(row, { ...want, replaces: 'b1' }, Date.parse(now))).toBe(false)
  })

  it('the card shows the uploader in Your work, with Replace and the timeline; the Drive scan is off unless asked for', () => {
    const drawer = readFileSync('app/dashboard/board/EditorCardDrawer.tsx', 'utf8')
    expect(drawer).toContain('<CardDriveUpload ref={cardUpload}')
    expect(drawer).toContain('cardUpload.current.replace(')
    expect(drawer).toContain('aria-label={`When ${f.name} was added`}')
    const server = readFileSync('app/lib/card-upload.ts', 'utf8')
    expect(server).not.toContain('LOCKED_STATUSES')
    expect(server).toContain('{ anyTime: true }')
    expect(readFileSync('app/inngest/functions.ts', 'utf8')).toContain("process.env.DRIVE_SCAN !== '1'")
  })
})
