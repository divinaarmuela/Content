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
