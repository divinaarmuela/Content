import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  folderFilesWords, folderTilesOf, readableFolderId, subfolderCount, tileActionWords,
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
    expect(drawer).toContain('linkOnly showFolderFiles={false} />')
    const box = src('app/dashboard/board/FilesToWorkFrom.tsx')
    expect(box).toContain('{folder && !linkOpen && showFolderFiles && <DriveFolderFiles url={folder} />}')
  })
  it('a tile is a button; the press mounts Drive’s preview — nothing loads for a tile nobody opened', () => {
    const c = src('app/dashboard/board/DriveFolderFiles.tsx')
    expect(c).toContain('aria-label={`${tileActionWords(t.kind)} ${t.name}`}')
    expect(c).toContain('<iframe key={showing.id} src={showing.preview} title={showing.name} allow="autoplay; fullscreen" allowFullScreen')
    expect(c).toContain('Open in Drive')
    expect(c).not.toContain('/api/drive/download')
  })
})
