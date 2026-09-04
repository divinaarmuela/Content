import { describe, expect, it } from 'vitest'
import {
  MAX_UPLOAD_BYTES, PARTIAL_VIEW_NOTE, UPLOAD_CHUNK,
  applyChunk, confirmRefusal, crumbTrail, driveOrderBy, driveQuery, escapeQuery,
  extensionBadge, filterEntries, formatBytes, formatModified, isDriveId, isFolder,
  kindOf, modifiedSince, moveConfirmWords, moveRefusal, nextChunk, nextSelection,
  openForPath, parseListRequest, pathInto, pathUpTo, renameConfirmWords, sortEntries,
  startUpload, toggleOpen, uploadPercent, uploadSummary, uploadWords,
  type DriveEntry, type Filters, type UploadState,
} from '../app/lib/files-core'

/**
 * The Files page's thinking, tested without Drive, without a database and
 * without a browser.
 *
 * Two blocks matter more than the rest. The `q` builder, because a query that
 * quietly escapes wrongly does not throw — it finds the WRONG folder, which is
 * how a client's files end up filed under somebody else. And the confirmation
 * gate, because the owner's instruction is that nothing in their Drive is ever
 * renamed or moved except by an explicit act of a person, and that rule is
 * only real if it is a property something can fail.
 */

const file = (over: Partial<DriveEntry> = {}): DriveEntry => ({
  id: 'aB1_-', name: 'Spring reel v2.mp4', mimeType: 'video/mp4', size: 118_000_000,
  modified: '2026-09-04T04:20:00.000Z', ownerName: 'Jess', ownerEmail: 'jess@md.invalid',
  hasThumbnail: true, webViewLink: null, ...over,
})
const folder = (over: Partial<DriveEntry> = {}): DriveEntry => file({
  name: 'Clients', mimeType: 'application/vnd.google-apps.folder', size: null, ...over,
})

/* ── ids ────────────────────────────────────────────────────────────────── */

describe('a Drive id is checked before it goes anywhere', () => {
  it('accepts what Drive actually issues', () => {
    expect(isDriveId('11LurZJxEOuysDaec-eKMeZemLqhgMq6K')).toBe(true)
    expect(isDriveId('a')).toBe(true)
  })

  it('refuses anything that could escape a query or a path', () => {
    for (const bad of [
      "abc' or '1'='1",           // out of the q string
      'abc/../def',               // out of the URL path
      'abc def',
      'abc\\def',
      '',
      'a'.repeat(300),
      null, undefined, 42, {},
    ]) {
      expect(isDriveId(bad as unknown), String(bad)).toBe(false)
    }
  })
})

/* ── kinds ──────────────────────────────────────────────────────────────── */

describe('what kind of thing this is', () => {
  it('reads Drive’s own types', () => {
    expect(kindOf('application/vnd.google-apps.folder')).toBe('folder')
    expect(kindOf('application/vnd.google-apps.document')).toBe('doc')
    expect(kindOf('application/vnd.google-apps.spreadsheet')).toBe('sheet')
    expect(kindOf('application/pdf')).toBe('pdf')
  })

  it('falls back to the name when the mime type gives nothing away', () => {
    // the real case: a ProRes master arrives as octet-stream
    expect(kindOf('application/octet-stream', 'Master cut.mov')).toBe('video')
    expect(kindOf('', 'September plan.docx')).toBe('doc')
    expect(kindOf(null, 'no extension')).toBe('other')
  })

  it('never lets the name beat a mime type that was clear', () => {
    expect(kindOf('image/png', 'thing.mp4')).toBe('image')
  })

  it('badges a tile with the extension, or the kind when there is none', () => {
    expect(extensionBadge('Spring reel v2.mp4', 'video')).toBe('MP4')
    expect(extensionBadge('README', 'other')).toBe('FILE')
  })
})

/* ── sorting ────────────────────────────────────────────────────────────── */

describe('sorting a listing', () => {
  const rows = [
    file({ id: 'b', name: 'beta.mp4', size: 20, modified: '2026-01-02T00:00:00.000Z' }),
    file({ id: 'a', name: 'Alpha.mp4', size: 10, modified: '2026-01-03T00:00:00.000Z' }),
    file({ id: 'c', name: 'Charlie.mp4', size: null, modified: null }),
  ]

  it('sorts by name without caring about case', () => {
    expect(sortEntries(rows, { by: 'name', dir: 'asc' }).map(r => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('sinks a missing size in BOTH directions — unknown is not small', () => {
    expect(sortEntries(rows, { by: 'size', dir: 'asc' }).map(r => r.id)).toEqual(['a', 'b', 'c'])
    expect(sortEntries(rows, { by: 'size', dir: 'desc' }).map(r => r.id)).toEqual(['b', 'a', 'c'])
  })

  it('is stable when two rows are the same', () => {
    const same = [file({ id: '1', size: 5 }), file({ id: '2', size: 5 })]
    expect(sortEntries(same, { by: 'size', dir: 'desc' }).map(r => r.id)).toEqual(['1', '2'])
  })

  it('asks Drive for folders first, whatever the sort', () => {
    expect(driveOrderBy({ by: 'name', dir: 'asc' })).toBe('folder,name')
    expect(driveOrderBy({ by: 'modified', dir: 'desc' })).toBe('folder,modifiedTime desc')
    expect(driveOrderBy({ by: 'size', dir: 'asc' })).toBe('folder,quotaBytesUsed')
  })

  it('knows a folder from a file', () => {
    expect(isFolder(folder())).toBe(true)
    expect(isFolder(file())).toBe(false)
  })
})

/* ── filtering ──────────────────────────────────────────────────────────── */

describe('the four filters', () => {
  const now = new Date('2026-09-04T12:00:00.000Z')
  const rows = [
    file({ id: 'vid', mimeType: 'video/mp4', modified: '2026-09-04T09:00:00.000Z' }),
    file({ id: 'pdf', mimeType: 'application/pdf', ownerEmail: 'sam@md.invalid', modified: '2026-01-01T00:00:00.000Z' }),
    folder({ id: 'dir', modified: '2026-09-01T00:00:00.000Z' }),
  ]
  const none = (_id: string): string | null => null
  const pick = (f: Partial<Filters>, clientOf: (id: string) => string | null = none) =>
    filterEntries(rows, { type: 'all', person: null, modified: 'any', client: null, ...f }, clientOf, now)
      .map(r => r.id)

  it('filters by type', () => {
    expect(pick({ type: 'video' })).toEqual(['vid'])
    expect(pick({ type: 'folder' })).toEqual(['dir'])
  })

  it('filters by who owns it, whatever the case', () => {
    expect(pick({ person: 'SAM@md.invalid' })).toEqual(['pdf'])
  })

  it('filters by when it last changed', () => {
    expect(pick({ modified: 'today' })).toEqual(['vid'])
    expect(pick({ modified: 'week' })).toEqual(['vid', 'dir'])
  })

  it('filters by client — and shows nothing we did not put there', () => {
    // the drive_files join answers for OUR files only; a stranger's PDF has
    // no client and must not be attributed to one
    expect(pick({ client: 'c1' }, id => (id === 'vid' ? 'c1' : null))).toEqual(['vid'])
    expect(pick({ client: 'c1' })).toEqual([])
  })

  it('drops nothing when nothing is chosen', () => {
    expect(pick({})).toEqual(['vid', 'pdf', 'dir'])
  })

  it('turns a window into an instant, and "any" into nothing', () => {
    expect(modifiedSince('any', now)).toBeNull()
    expect(modifiedSince('today', now)).toBe('2026-09-03T12:00:00.000Z')
  })
})

/* ── the query Drive is asked ───────────────────────────────────────────── */

describe('the Drive query', () => {
  it('escapes a backslash before an apostrophe, or the escapes escape themselves', () => {
    expect(escapeQuery("Nathan's")).toBe("Nathan\\'s")
    expect(escapeQuery('a\\b')).toBe('a\\\\b')
    expect(escapeQuery("a\\'b")).toBe("a\\\\\\'b")
  })

  it('asks for one folder’s children', () => {
    expect(driveQuery({ parentId: 'HQ1' }))
      .toBe("trashed = false and 'HQ1' in parents")
  })

  it('searches by name inside a folder', () => {
    expect(driveQuery({ parentId: 'HQ1', text: "Cecconi's" }))
      .toBe("trashed = false and 'HQ1' in parents and name contains 'Cecconi\\'s'")
  })

  it('searches everywhere the app can see when no folder is given', () => {
    expect(driveQuery({ text: 'reel' })).toBe("trashed = false and name contains 'reel'")
  })

  it('narrows by type, by date and by owner', () => {
    const q = driveQuery({
      parentId: 'HQ1', type: 'video',
      since: '2026-09-01T00:00:00.000Z', ownerEmail: 'jess@md.invalid',
    })
    expect(q).toContain("mimeType contains 'video/'")
    expect(q).toContain("modifiedTime > '2026-09-01T00:00:00.000Z'")
    expect(q).toContain("'jess@md.invalid' in owners")
  })

  it('does not try to ask Drive for "everything else" — it has no mime', () => {
    expect(driveQuery({ parentId: 'HQ1', type: 'other' }))
      .toBe("trashed = false and 'HQ1' in parents")
  })

  it('asks for folders only, for the left rail', () => {
    expect(driveQuery({ parentId: 'HQ1', foldersOnly: true }))
      .toContain("mimeType = 'application/vnd.google-apps.folder'")
  })
})

/* ── reading a request ──────────────────────────────────────────────────── */

describe('parsing a listing request', () => {
  const from = (params: Record<string, string>) =>
    parseListRequest(k => params[k] ?? null)

  it('refuses a parent that is not a Drive id', () => {
    const parsed = from({ parent: "x' or '1" })
    expect(parsed.ok).toBe(false)
  })

  it('drops a filter it does not recognise rather than failing', () => {
    const parsed = from({ parent: 'HQ1', type: 'sausage', modified: 'fortnight' })
    expect(parsed.ok && parsed.request.type).toBe('all')
    expect(parsed.ok && parsed.request.modified).toBe('any')
  })

  it('reads the real thing', () => {
    const parsed = from({
      parent: 'HQ1', q: '  reel  ', type: 'video', modified: 'week',
      owner: 'jess@md.invalid', sort: 'modified', dir: 'desc', folders: '1',
    })
    expect(parsed.ok && parsed.request).toEqual({
      parentId: 'HQ1', text: 'reel', type: 'video', modified: 'week',
      ownerEmail: 'jess@md.invalid', foldersOnly: true,
      sort: { by: 'modified', dir: 'desc' }, pageToken: null,
    })
  })
})

/* ── the breadcrumb ─────────────────────────────────────────────────────── */

describe('the breadcrumb', () => {
  const path = [
    { id: 'hq', name: 'MD Media HQ' },
    { id: 'cl', name: 'Clients' },
    { id: 'pa', name: 'Pure Allure' },
    { id: 'sh', name: 'Sept shoot' },
    { id: 'ed', name: '02 Edits' },
  ]

  it('shows the whole trail when it fits', () => {
    expect(crumbTrail(path.slice(0, 3)).hidden).toEqual([])
  })

  it('never drops the root or where you are', () => {
    const { visible, hidden } = crumbTrail(path, 4)
    expect(visible.map(c => c.id)).toEqual(['hq', 'pa', 'sh', 'ed'])
    expect(hidden.map(c => c.id)).toEqual(['cl'])
  })

  it('walks back up to a crumb', () => {
    expect(pathUpTo(path, 'cl').map(c => c.id)).toEqual(['hq', 'cl'])
    expect(pathUpTo(path, 'nowhere')).toEqual(path)
  })

  it('walks down, and never doubles a folder already on the path', () => {
    expect(pathInto(path.slice(0, 2), { id: 'pa', name: 'Pure Allure' }).map(c => c.id))
      .toEqual(['hq', 'cl', 'pa'])
    expect(pathInto(path, { id: 'cl', name: 'Clients' }).map(c => c.id)).toEqual(['hq', 'cl'])
  })

  it('opens every folder on the path in the tree', () => {
    expect(openForPath(['other'], path).sort())
      .toEqual(['cl', 'ed', 'hq', 'other', 'pa', 'sh'])
  })

  it('toggles one branch without touching the rest', () => {
    expect(toggleOpen(['a', 'b'], 'b')).toEqual(['a'])
    expect(toggleOpen(['a'], 'b')).toEqual(['a', 'b'])
  })
})

/* ── moving ─────────────────────────────────────────────────────────────── */

describe('what may be dropped where', () => {
  const ancestors: Record<string, string[]> = { deep: ['hq', 'top'], top: ['hq'], hq: [] }
  const of = (id: string) => ancestors[id] ?? []

  it('refuses an empty drag', () => {
    expect(moveRefusal([], 'hq', of)).toBe('Nothing was picked up.')
  })

  it('refuses a folder into itself', () => {
    expect(moveRefusal(['hq'], 'hq', of)).toBe('A folder cannot go inside itself.')
  })

  it('refuses a folder into its own descendant — Drive would accept it', () => {
    expect(moveRefusal(['top'], 'deep', of))
      .toBe('A folder cannot go inside one of its own folders.')
  })

  it('allows a real move', () => {
    expect(moveRefusal(['file1'], 'deep', of)).toBeNull()
  })
})

describe('picking several things', () => {
  const ids = ['a', 'b', 'c', 'd']

  it('a plain click picks one', () => {
    expect(nextSelection(['a'], ids, 'c', {})).toEqual(['c'])
  })

  it('ctrl adds and removes', () => {
    expect(nextSelection(['a'], ids, 'c', { ctrl: true })).toEqual(['a', 'c'])
    expect(nextSelection(['a', 'c'], ids, 'c', { ctrl: true })).toEqual(['a'])
  })

  it('shift takes the run between, in either direction', () => {
    expect(nextSelection(['b'], ids, 'd', { shift: true })).toEqual(['b', 'c', 'd'])
    expect(nextSelection(['d'], ids, 'b', { shift: true })).toEqual(['b', 'c', 'd'])
  })

  it('shift with nothing picked yet is just a click', () => {
    expect(nextSelection([], ids, 'c', { shift: true })).toEqual(['c'])
  })
})

/* ── the confirmation gate — the owner's rule ───────────────────────────── */

describe('nothing changes without a person saying so', () => {
  it('refuses a body with no confirmation', () => {
    for (const body of [{}, { confirm: false }, { confirm: 'true' }, { confirm: 1 }]) {
      expect(confirmRefusal(body as { confirm?: unknown })).toMatch(/needs to be confirmed/)
    }
  })

  it('lets an explicit true through', () => {
    expect(confirmRefusal({ confirm: true })).toBeNull()
  })

  it('names the thing out loud in the question', () => {
    expect(renameConfirmWords('Sui Kitchen', 'Sui Kitchen Melbourne'))
      .toBe('Rename “Sui Kitchen” to “Sui Kitchen Melbourne”?')
    expect(moveConfirmWords(['Spring reel v2.mp4'], 'Clients'))
      .toBe('Move “Spring reel v2.mp4” into “Clients”?')
    expect(moveConfirmWords(['a', 'b', 'c'], 'Clients'))
      .toBe('Move 3 items into “Clients”?')
  })
})

/* ── the upload state machine ───────────────────────────────────────────── */

describe('an upload, slice by slice', () => {
  const big = () => startUpload('master.mov', UPLOAD_CHUNK * 2 + 500)

  it('stays inside a serverless request body, and on a 256 KB boundary', () => {
    expect(UPLOAD_CHUNK).toBeLessThan(4.5 * 1024 * 1024)
    expect(UPLOAD_CHUNK % (256 * 1024)).toBe(0)
  })

  it('walks the file in chunks and stops at the end', () => {
    let state = big()
    const ranges: [number, number][] = []
    for (let i = 0; i < 10; i++) {
      const slice = nextChunk(state)
      if (!slice) break
      ranges.push([slice.start, slice.end])
      state = applyChunk(state, { received: slice.end })
    }
    expect(ranges).toEqual([
      [0, UPLOAD_CHUNK],
      [UPLOAD_CHUNK, UPLOAD_CHUNK * 2],
      [UPLOAD_CHUNK * 2, UPLOAD_CHUNK * 2 + 500],
    ])
  })

  it('believes Drive over its own arithmetic', () => {
    let state = big()
    // we sent a whole chunk; Drive says it kept half of it
    state = applyChunk(state, { received: UPLOAD_CHUNK / 2 })
    expect(nextChunk(state)?.start).toBe(UPLOAD_CHUNK / 2)
  })

  it('gives a zero-byte file exactly one chunk', () => {
    let state = startUpload('empty.txt', 0)
    expect(nextChunk(state)).toEqual({ start: 0, end: 0 })
    state = applyChunk(state, { done: true })
    expect(nextChunk(state)).toBeNull()
    expect(state.status).toBe('done')
  })

  it('stops for good on a failure — it never starts again on its own', () => {
    const state = applyChunk(big(), { error: 'Google Drive 503 during the upload' })
    expect(state.status).toBe('failed')
    expect(nextChunk(state)).toBeNull()
  })

  it('never shows 100% until Drive has said the file is finished', () => {
    let state = big()
    state = applyChunk(state, { received: state.size })
    expect(uploadPercent(state)).toBe(99)
    state = applyChunk(state, { done: true })
    expect(uploadPercent(state)).toBe(100)
  })

  it('says what is happening in words a person reads', () => {
    const failed: UploadState = { name: 'a', size: 1, sent: 0, status: 'failed', error: 'It broke' }
    expect(uploadWords(failed)).toBe('It broke')
    expect(uploadWords(startUpload('a', 10))).toBe('Waiting')
    expect(uploadSummary([startUpload('a', 1), startUpload('b', 1)])).toBe('Uploading 2 files')
    expect(uploadSummary([failed])).toBe('1 file did not go up')
    expect(uploadSummary([{ ...startUpload('a', 1), status: 'done' }])).toBe('All uploaded')
  })

  it('quotes Drive’s own ceiling', () => {
    expect(MAX_UPLOAD_BYTES).toBe(5 * 1024 ** 4)
  })
})

/* ── words ──────────────────────────────────────────────────────────────── */

describe('words on the screen', () => {
  it('writes a size a person reads', () => {
    expect(formatBytes(null)).toBe('—')
    expect(formatBytes(0)).toBe('0 bytes')
    expect(formatBytes(900)).toBe('900 bytes')
    expect(formatBytes(1536)).toBe('2 KB')
    expect(formatBytes(118_000_000)).toBe('113 MB')
  })

  it('writes today and yesterday by name', () => {
    const now = new Date('2026-09-04T20:00:00')
    expect(formatModified('2026-09-04T14:20:00', now)).toBe('Today 14:20')
    expect(formatModified('2026-09-03T09:05:00', now)).toBe('Yesterday 09:05')
    expect(formatModified(null, now)).toBe('—')
  })

  it('admits what the app cannot see, in plain words', () => {
    expect(PARTIAL_VIEW_NOTE).toMatch(/Google Drive/)
    expect(PARTIAL_VIEW_NOTE).not.toMatch(/scope|drive\.file|OAuth/i)
  })
})
