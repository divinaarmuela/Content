import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  CANVAS_DRIVE_FILES_MAX, driveButtonWords, driveFileFromEntry, driveFilesWords, driveStreamUrl, driveThumbnailUrl,
  isPickableEntry, mayPickDriveFile, postMediaOf, sanitiseDriveFiles, withDriveFiles, withoutDriveFile,
} from '../app/lib/canvas-drive-core'
import { applyCanvasOp, sanitiseCanvasCards, type CanvasCard } from '../app/lib/batch-brief-core'
import { FILES_ROLE } from '../app/lib/drive-page'
import { roleSatisfies, type Role } from '../app/lib/identity-core'

/**
 * A DRIVE FILE ON A POST CARD (the owner, 22 Sep 2026: "on the board page …
 * the post toolbar, and then I will choose one of the Instagram options. I
 * should be able to add the Drive file and it will read [it and] put it on
 * the post I chose"). Read only, trap 13: the card keeps the file's id and
 * name and draws it through the read proxies; nothing in Drive changes.
 */
const src = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const pic = { id: 'abc123_-ABC', name: 'Spring.jpg', kind: 'image' as const, mime: 'image/jpeg' }
const clip = { id: 'clip456', name: 'Reel one.mp4', kind: 'video' as const, mime: 'video/mp4' }

describe('sanitiseDriveFiles', () => {
  it('keeps a picture or a clip with a Drive id and a name; drops anything else; dedupes; caps at ten', () => {
    expect(sanitiseDriveFiles([pic, clip])).toEqual([pic, clip])
    expect(sanitiseDriveFiles([{ ...pic, mime: '' }])).toEqual([{ id: pic.id, name: pic.name, kind: 'image' }])
    expect(sanitiseDriveFiles([{ ...pic, id: 'has/slash' }])).toEqual([])
    expect(sanitiseDriveFiles([{ ...pic, id: 'a b' }])).toEqual([])
    expect(sanitiseDriveFiles([{ ...pic, kind: 'pdf' }])).toEqual([])
    expect(sanitiseDriveFiles([{ ...pic, name: '   ' }])).toEqual([])
    expect(sanitiseDriveFiles([pic, pic, clip])).toEqual([pic, clip])
    expect(sanitiseDriveFiles(Array.from({ length: 30 }, (_, i) => ({ ...pic, id: `id${i}` }))).length).toBe(CANVAS_DRIVE_FILES_MAX)
    expect(sanitiseDriveFiles(null)).toEqual([])
    expect(sanitiseDriveFiles('x')).toEqual([])
    expect(sanitiseDriveFiles([null, 3, 'x'])).toEqual([])
    expect(sanitiseDriveFiles([{ ...pic, name: 'n'.repeat(500) }])[0].name.length).toBe(200)
  })
})

describe('what the picker offers', () => {
  it('a folder, a picture or a clip is shown; a PDF or a doc is not', () => {
    expect(isPickableEntry({ id: 'f', name: 'Clients', mimeType: 'application/vnd.google-apps.folder' })).toBe(true)
    expect(isPickableEntry({ id: 'f', name: 'a.jpg', mimeType: 'image/jpeg' })).toBe(true)
    expect(isPickableEntry({ id: 'f', name: 'a.mov', mimeType: 'video/quicktime' })).toBe(true)
    // Drive calls a ProRes master octet-stream often enough: the name decides
    expect(isPickableEntry({ id: 'f', name: 'master.mov', mimeType: 'application/octet-stream' })).toBe(true)
    expect(isPickableEntry({ id: 'f', name: 'brief.pdf', mimeType: 'application/pdf' })).toBe(false)
    expect(isPickableEntry({ id: 'f', name: 'notes', mimeType: 'application/vnd.google-apps.document' })).toBe(false)
  })
  it('a listing row becomes the file the card keeps — and only a picture or a clip does', () => {
    expect(driveFileFromEntry({ id: 'abc', name: ' Spring.jpg ', mimeType: 'image/jpeg' })).toEqual({ id: 'abc', name: 'Spring.jpg', kind: 'image', mime: 'image/jpeg' })
    expect(driveFileFromEntry({ id: 'abc', name: 'clip.mp4', mimeType: 'video/mp4' })).toEqual({ id: 'abc', name: 'clip.mp4', kind: 'video', mime: 'video/mp4' })
    expect(driveFileFromEntry({ id: 'abc', name: 'brief.pdf', mimeType: 'application/pdf' })).toBeNull()
    expect(driveFileFromEntry({ id: 'abc', name: 'Clients', mimeType: 'application/vnd.google-apps.folder' })).toBeNull()
    expect(driveFileFromEntry({ id: 'bad id', name: 'a.jpg', mimeType: 'image/jpeg' })).toBeNull()
  })
})

describe('what the card draws', () => {
  it('a picture through the thumbnail proxy, a clip through the stream proxy — same origin, no token, the routes the Files page already reads with', () => {
    expect(driveThumbnailUrl('abc')).toBe('/api/drive/thumbnail?id=abc&size=800')
    expect(driveThumbnailUrl('abc', 400)).toBe('/api/drive/thumbnail?id=abc&size=400')
    expect(driveStreamUrl(clip)).toBe('/api/drive/stream?id=clip456&name=Reel%20one.mp4')
  })
  it('a single-media post shows its Drive file before its upload; a carousel shows its uploads then its Drive files, each a slide', () => {
    expect(postMediaOf({ platform: 'ig_post', url: 'https://x/a.jpg' })).toEqual([
      { key: 'upload:https://x/a.jpg', picture: 'https://x/a.jpg', video: null, name: null, from: 'upload' },
    ])
    expect(postMediaOf({ platform: 'ig_post', url: 'https://x/a.jpg', drive_files: [clip] })).toEqual([
      { key: 'drive:clip456', picture: '/api/drive/thumbnail?id=clip456&size=800', video: '/api/drive/stream?id=clip456&name=Reel%20one.mp4', name: 'Reel one.mp4', from: 'drive' },
    ])
    expect(postMediaOf({ platform: 'ig_reel', drive_files: [pic, clip] }).map(m => m.key)).toEqual(['drive:abc123_-ABC'])
    expect(postMediaOf({ platform: 'ig_carousel', urls: ['https://x/1.jpg', 'https://x/2.mp4'], drive_files: [pic] }).map(m => [m.key, m.picture, m.video])).toEqual([
      ['upload:https://x/1.jpg', 'https://x/1.jpg', null],
      ['upload:https://x/2.mp4', null, 'https://x/2.mp4'],
      ['drive:abc123_-ABC', '/api/drive/thumbnail?id=abc123_-ABC&size=800', null],
    ])
    expect(postMediaOf({ platform: 'ig_post' })).toEqual([])
  })
})

describe('putting a file on the post, and taking it off', () => {
  const post: CanvasCard = { id: 'c1', kind: 'mockup', platform: 'ig_post', x: 0, y: 0, w: 280, z: 1, url: 'https://x/old.jpg', text: 'cap', link_url: 'https://www.instagram.com/p/abc/' }
  it('a single-media post takes the first pick and lets go of its upload; its frame, caption, link and place stay', () => {
    const next = withDriveFiles(post, [clip, pic])
    expect(next.drive_files).toEqual([clip])
    expect(next.url).toBeUndefined()
    expect(next).toMatchObject({ id: 'c1', platform: 'ig_post', x: 0, y: 0, w: 280, text: 'cap', link_url: 'https://www.instagram.com/p/abc/' })
    expect(withDriveFiles(post, [])).toBe(post)
    expect(withDriveFiles(post, [{ ...pic, id: 'bad id' }])).toBe(post)
  })
  it('a carousel appends the picks as slides, skips a file already on it, keeps its uploads, ten at most', () => {
    const car: CanvasCard = { ...post, platform: 'ig_carousel', urls: ['https://x/1.jpg'], drive_files: [pic] }
    const next = withDriveFiles(car, [pic, clip])
    expect(next.drive_files).toEqual([pic, clip])
    expect(next.urls).toEqual(['https://x/1.jpg'])
    const many = withDriveFiles(car, Array.from({ length: 20 }, (_, i) => ({ ...clip, id: `id${i}` })))
    expect(many.drive_files?.length).toBe(CANVAS_DRIVE_FILES_MAX)
  })
  it('taking the file off leaves the frame empty — the file itself never left Drive', () => {
    const on = withDriveFiles(post, [clip])
    expect(withoutDriveFile(on).drive_files).toBeUndefined()
    const car = withDriveFiles({ ...post, platform: 'ig_carousel' as const }, [pic, clip])
    expect(withoutDriveFile(car, pic.id).drive_files).toEqual([clip])
    expect(withoutDriveFile(car, clip.id).drive_files).toEqual([pic])
    expect(withoutDriveFile(withoutDriveFile(car, clip.id), pic.id).drive_files).toBeUndefined()
  })
  it('the toolbar says what the press will do', () => {
    expect(driveButtonWords({ platform: 'ig_post' })).toBe('Add a Drive file')
    expect(driveButtonWords({ platform: 'ig_post', drive_files: [pic] })).toBe('Swap Drive file')
    expect(driveButtonWords({ platform: 'ig_carousel', drive_files: [pic] })).toBe('Add Drive files')
    expect(driveFilesWords(undefined)).toBeNull()
    expect(driveFilesWords([pic])).toBe('From Drive: Spring.jpg')
    expect(driveFilesWords([pic, clip])).toBe('2 files from Drive')
  })
})

describe('the card, through the sanitiser and the per-card merge', () => {
  it('a post card keeps its Drive files through sanitiseCanvasCards; a bad one is dropped; no other kind carries them', () => {
    const [card] = sanitiseCanvasCards([{ id: 'c1', kind: 'mockup', platform: 'ig_reel', x: 1, y: 2, w: 200, z: 1, drive_files: [clip, { id: 'x/y', name: 'bad', kind: 'video' }, { id: 'p', name: 'brief.pdf', kind: 'pdf' }] }])
    expect(card.drive_files).toEqual([clip])
    const [img] = sanitiseCanvasCards([{ id: 'i1', kind: 'image', url: 'https://x/a.jpg', x: 1, y: 2, w: 200, z: 1, drive_files: [clip] }])
    expect(img.drive_files).toBeUndefined()
    const [empty] = sanitiseCanvasCards([{ id: 'c2', kind: 'mockup', platform: 'ig_post', x: 1, y: 2, w: 200, z: 1, drive_files: [] }])
    expect('drive_files' in empty).toBe(false)
  })
  it('the op the page sends — the card with the file on it — merges on the row as it stands', () => {
    const current = [{ id: 'c1', kind: 'mockup', platform: 'ig_post', x: 0, y: 0, w: 280, z: 1, url: 'https://x/old.jpg' }, { id: 'n1', kind: 'note', text: 'hi', x: 0, y: 0, w: 200, z: 2 }]
    const [c1] = sanitiseCanvasCards(current) as CanvasCard[]
    const merged = applyCanvasOp(current, { upsert: [withDriveFiles(c1, [pic])] })
    expect(merged.find(c => c.id === 'c1')).toMatchObject({ drive_files: [pic] })
    expect(merged.find(c => c.id === 'c1')?.url).toBeUndefined()
    expect(merged.find(c => c.id === 'n1')).toMatchObject({ text: 'hi' })
  })
})

describe('who may pick', () => {
  it('whoever may work on the board — every team role, never a client — which is exactly the line the Drive read routes hold', () => {
    for (const role of ['scheduler', 'editor', 'quality_checker', 'general', 'account_manager', 'super_admin'] as Role[]) {
      expect(mayPickDriveFile({ role })).toBe(true)
      expect(roleSatisfies(role, FILES_ROLE)).toBe(true)
    }
    expect(mayPickDriveFile({ role: 'client' })).toBe(false)
    expect(roleSatisfies('client', FILES_ROLE)).toBe(false)
    expect(mayPickDriveFile(null)).toBe(false)
    expect(mayPickDriveFile(undefined)).toBe(false)
  })
})

describe('the board and the card, as drawn', () => {
  it('the post card’s toolbar offers a Drive file and takes it off; the picker is the Files page’s window, read only; the team board has the same toolbar as the shoot brief', () => {
    const canvas = src('app/dashboard/production/shoots/[id]/BriefCanvas.tsx')
    expect(canvas).toContain('<HardDrive className="h-3.5 w-3.5" /> {driveButtonWords(card)}')
    expect(canvas).toContain("{card.drive_files.length > 1 ? 'Remove Drive files' : 'Remove Drive file'}")
    expect(canvas).toContain('onPick={attachDriveFiles}')
    expect(canvas).toContain("multiple={cards.find(c => c.id === drivePick)?.platform === 'ig_carousel'}")
    // the Post tool is on every board's toolbar, the team's included: it is
    // not behind any prop, only behind being allowed to edit
    expect(canvas).toContain('<Smartphone className="h-3.5 w-3.5" /> Post')
    expect(src('app/dashboard/team-boards/[id]/page.tsx')).toContain('<BriefCanvas cards={cards} references={[]} canEdit={mayEditTeamBoard(me)} onOp={onOp} />')

    const card = src('app/dashboard/production/shoots/[id]/CanvasCard.tsx')
    expect(card).toContain('<PostMediaFrame key={driveOne.key} media={driveOne} playing={playing} onPlay={onPlay} />')
    expect(card).toContain('<PostMediaFrame key={cur.key} media={cur} playing={playing} onPlay={onPlay} />')
    expect(card).toContain('<HardDrive className="h-2.5 w-2.5 shrink-0" aria-hidden /><span className="truncate">{media.name}</span>')

    const picker = src('app/components/canvas/DriveFilePicker.tsx')
    expect(picker).toContain("fetch('/api/drive/root', { cache: 'no-store' })")
    expect(picker).toContain("import FilesTree from '@/app/dashboard/files/FilesTree'")
    expect(picker).toContain("import { useDriveBrowse, useFolderChildren } from '@/app/dashboard/files/useDriveBrowse'")
    expect(picker).toContain('Google Drive, read only — a picked file is shown on the post from where it sits. Nothing in Drive changes.')
    // READ ONLY (trap 13): the picker reads Drive's root, a listing and a
    // thumbnail, and nothing else — no upload, folder, move, rename, share or delete
    for (const write of ['/api/drive/upload', '/api/drive/folder', '/api/drive/move', '/api/drive/rename', '/api/drive/share', '/api/drive/pull', "method: 'POST'", "method: 'PATCH'", "method: 'DELETE'"]) {
      expect(picker).not.toContain(write)
    }
  })
})
