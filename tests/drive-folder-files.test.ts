import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  folderFilesWords, folderTilesOf, folderUnreadableWords, parsePublicFolderView, readableFolderId, subfolderCount, tileActionWords,
} from '../app/lib/drive-folder-files-core'
import type { DriveEntry } from '../app/lib/files-core'

/**
 * THE FILES BEHIND A CARD'S DRIVE LINK, AS TILES (the owner, 15 Sep 2026:
 * "in Editor, display files as their thumbnail and play it from there" —
 * "not files, the Drive link").
 */
const entry = (over: Partial<DriveEntry>): DriveEntry => ({
  id: 'f1', name: 'clip.mov', mimeType: 'video/quicktime', size: 100, modified: null,
  ownerName: null, ownerEmail: null, hasThumbnail: true, webViewLink: null, ...over,
})

describe('folderTilesOf', () => {
  it('draws each file as a tile: Drive’s thumbnail through our proxy, Drive’s preview on a press, Open in Drive', () => {
    const [t] = folderTilesOf([entry({ id: 'abc123abc123', name: 'Spring.mov' })])
    expect(t).toEqual({
      id: 'abc123abc123', name: 'Spring.mov', kind: 'video',
      thumb: '/api/drive/thumbnail?id=abc123abc123&size=400',
      preview: 'https://drive.google.com/file/d/abc123abc123/preview',
      open: 'https://drive.google.com/file/d/abc123abc123/view',
    })
  })
  it('keeps Drive’s own view link when it has one, and no picture when Drive has none', () => {
    const [t] = folderTilesOf([entry({ hasThumbnail: false, webViewLink: 'https://drive.google.com/x' })])
    expect(t.thumb).toBeNull()
    expect(t.open).toBe('https://drive.google.com/x')
  })
  it('skips subfolders — they are opened in Drive, not drawn', () => {
    const rows = [entry({}), entry({ id: 'd', name: 'Raw', mimeType: 'application/vnd.google-apps.folder' })]
    expect(folderTilesOf(rows).map(t => t.id)).toEqual(['f1'])
    expect(subfolderCount(rows)).toBe(1)
  })
  it('names the kind so the press reads Play or See', () => {
    expect(tileActionWords('video')).toBe('Play')
    expect(tileActionWords('audio')).toBe('Play')
    expect(tileActionWords('image')).toBe('See')
    expect(tileActionWords('pdf')).toBe('See')
  })
})

describe('the words and the link', () => {
  it('says how much is in the folder, in plain words', () => {
    expect(folderFilesWords(0, 0)).toBe('No files in the folder yet')
    expect(folderFilesWords(1, 0)).toBe('1 file in the folder')
    expect(folderFilesWords(12, 2)).toBe('12 files in the folder, and 2 subfolders — open the folder for those')
  })
  it('only a Google Drive FOLDER link can be read; Dropbox and file links cannot', () => {
    expect(readableFolderId('https://drive.google.com/drive/folders/19gBCT4a6lEXzQik8ibi_uUfsUDEFMQ3D')).toBe('19gBCT4a6lEXzQik8ibi_uUfsUDEFMQ3D')
    expect(readableFolderId('https://www.dropbox.com/scl/fo/abc/h')).toBeNull()
    expect(readableFolderId('https://drive.google.com/file/d/19gBCT4a6lEXzQik8ibi_uUfsUDEFMQ3D/view')).toBeNull()
    expect(readableFolderId(null)).toBeNull()
  })
})

describe('the route and the drawers (source pins)', () => {
  const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
  it('/api/drive/children is a read: role gate, one page in name order, no HQ fence — a footage folder is wherever it is', () => {
    const s = src('app/api/drive/children/route.ts')
    expect(s).toContain('export async function GET(')
    expect(s).not.toMatch(/export async function (POST|PATCH|PUT|DELETE)\(/)
    expect(s).toContain('await requireFilesAccess()')
    expect(s).toContain("listEntries({ parentId: id, pageSize: CHILDREN_PAGE, sort: { by: 'name', dir: 'asc' } })")
    expect(s).not.toContain('outsideHqRefusal')
  })
  it('the editor’s drawer draws the footage folder’s files under the Footage folder line; the files box draws them under Open the folder, not twice', () => {
    const drawer = src('app/dashboard/board/EditorCardDrawer.tsx')
    expect(drawer).toContain('<DriveFolderFiles url={from.footage} />')
    expect(drawer).toContain('holder={holder} frozen={frozen} linkOnly showFolderFiles={false} />}')
    const box = src('app/dashboard/board/FilesToWorkFrom.tsx')
    expect(box).toContain('{folder && !linkOpen && showFolderFiles && <DriveFolderFiles url={folder} wide={wideFiles} />}')
    // the holder may change the folder link; only a manager adds files (15 Sep 2026)
    expect(box).toContain('const mayEdit = (isManager || holder) && !frozen')
    expect(box).toContain('const mayAddFiles = isManager && !linkOnly && !frozen')
  })
  it('a tile is a button; the press mounts Drive’s preview — nothing loads for a tile nobody opened', () => {
    const c = src('app/dashboard/board/DriveFolderFiles.tsx')
    expect(c).toContain('aria-label={`${tileActionWords(t.kind)} ${t.name}`}')
    expect(c).toContain('<iframe key={showing.id} src={showing.preview} title={showing.name} allow="autoplay; fullscreen" allowFullScreen')
    expect(c).toContain('Open in Drive')
    expect(c).not.toContain('/api/drive/download')
  })
})

describe('a folder the agency account was never shared on (the owner, 15 Sep 2026: "No files in the folder yet" over sixteen clips)', () => {
  // Google's public folder view of the owner's real footage folder, saved on 15 Sep 2026
  const html = readFileSync(join(process.cwd(), 'tests/fixtures/drive-public-folder-view.html'), 'utf8')
  it('reads every entry off the public folder view: id, name, type, and Drive’s own picture at tile size', () => {
    const entries = parsePublicFolderView(html)
    expect(entries).toHaveLength(16)
    const folder = entries.find(e => e.name === 'MXF')!
    expect(folder.mimeType).toBe('application/vnd.google-apps.folder')
    expect(folder.webViewLink).toBe('https://drive.google.com/drive/folders/1Umlc9vGp2RpI2Mf-RQUEL-mGzdFpyK52')
    const clip = entries.find(e => e.name === '10.9.26.mp4')!
    expect(clip.id).toBe('1_c2btM6QZ5DshW1dgK7P7CsAECnk1zTB')
    expect(clip.mimeType).toBe('video/mp4')
    expect(clip.hasThumbnail).toBe(true)
    expect(clip.thumbUrl).toMatch(/^https:\/\/lh3\.googleusercontent\.com\/drive-storage\/.+=s400$/)
    expect(clip.webViewLink).toBe('https://drive.google.com/file/d/1_c2btM6QZ5DshW1dgK7P7CsAECnk1zTB/view')
  })
  it('those entries make the same tiles — the public picture instead of our proxy, subfolders skipped', () => {
    const tiles = folderTilesOf(parsePublicFolderView(html))
    expect(tiles).toHaveLength(15)
    expect(tiles.every(t => t.kind === 'video')).toBe(true)
    expect(tiles[0].thumb).toMatch(/^https:\/\/lh3\.googleusercontent\.com\//)
    expect(tiles[0].preview).toMatch(/^https:\/\/drive\.google\.com\/file\/d\/[\w-]+\/preview$/)
  })
  it('an empty page is an empty list, not a crash', () => {
    expect(parsePublicFolderView('')).toEqual([])
    expect(parsePublicFolderView('<html><body>Sign in</body></html>')).toEqual([])
  })
  it('when neither way can see the folder, the words say what to do', () => {
    expect(folderUnreadableWords('tech@mdmmarketing.com.au')).toBe('The files could not be read — share it with tech@mdmmarketing.com.au, or set the folder to anyone with the link, and they show here.')
    expect(folderUnreadableWords(null)).toContain('share it with the agency’s Drive account')
  })
  it('the route asks the account first, then the public view, and never writes (source pins)', () => {
    const s = readFileSync(join(process.cwd(), 'app/api/drive/children/route.ts'), 'utf8')
    expect(s).toContain('if (result.ok && result.entries.length > 0) {')
    expect(s).toContain('const seen = await publicFolderEntries(id)')
    expect(s).toContain('note: folderUnreadableWords(account?.account_email ?? null)')
    expect(s).not.toMatch(/method: '(POST|PATCH|PUT|DELETE)'/)
    const c = readFileSync(join(process.cwd(), 'app/dashboard/board/DriveFolderFiles.tsx'), 'utf8')
    expect(c).toContain('{state.note ?? folderFilesWords(state.tiles.length, state.folders)}')
  })
})
