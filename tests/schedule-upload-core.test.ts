import { describe, expect, it } from 'vitest'
import {
  contentTypeForFiles, firstSource, isFileDrag, MAX_ITEM_TITLE, newPostSources,
  refusedFilesLine, titleForUpload, uploadOutcomeLine, usableUploadFiles,
} from '@/app/lib/schedule-upload-core'

/**
 * WHAT "NEW POST" OFFERS WHEN THERE IS NOTHING IN THE DATABASE YET.
 *
 * The bug this feature fixes was a workspace with two pieces and no media at
 * all: the rail said "Media 0", the chooser was empty, and the owner read the
 * whole feature as missing. Everything below is the arithmetic of the fix, so
 * it can be checked without a bucket, a browser or a Drive account.
 */

describe('the sources New post opens on', () => {
  it('puts Upload first, always — that is the step this change removes', () => {
    const sources = newPostSources({ driveAvailable: true, approvedCount: 9 })
    expect(sources.map(s => s.key)).toEqual(['upload', 'drive', 'approved'])
    expect(firstSource(sources)).toBe('upload')
  })

  it('offers Upload alone on an empty workspace — never a dead end', () => {
    const sources = newPostSources({ driveAvailable: false, approvedCount: 0 })
    expect(sources.map(s => s.key)).toEqual(['upload'])
  })

  it('hides Google Drive where this client has no folder to read', () => {
    const sources = newPostSources({ driveAvailable: false, approvedCount: 3 })
    expect(sources.map(s => s.key)).toEqual(['upload', 'approved'])
  })

  it('says what each source is, in plain words and never "graphic"', () => {
    for (const s of newPostSources({ driveAvailable: true, approvedCount: 1 })) {
      expect(s.help.length).toBeGreaterThan(10)
      expect(s.help.toLowerCase()).not.toContain('graphic')
      expect(s.label.toLowerCase()).not.toContain('piece')
    }
  })
})

describe('what the files make', () => {
  it('two or more files is a carousel', () => {
    expect(contentTypeForFiles([{ type: 'image' }, { type: 'image' }])).toBe('carousel')
    expect(contentTypeForFiles([{ type: 'video' }, { type: 'image' }])).toBe('carousel')
  })

  it('one video is a Reel and one picture is a still', () => {
    expect(contentTypeForFiles([{ type: 'video' }])).toBe('reel')
    expect(contentTypeForFiles([{ type: 'image' }])).toBe('static')
  })

  it('answers something sensible for nothing at all', () => {
    expect(contentTypeForFiles([])).toBe('static')
  })
})

describe('what the piece behind the post is called', () => {
  it('uses the file name, tidied, with the extension gone', () => {
    expect(titleForUpload({ fileName: 'spring_launch-02.MP4' })).toBe('spring launch 02')
  })

  it('prefers the caption when there is one — that is what the post is about', () => {
    expect(titleForUpload({ fileName: 'IMG_4821.jpg', caption: 'Doors open at six' }))
      .toBe('Doors open at six')
  })

  it('is never blank, whatever it is handed', () => {
    expect(titleForUpload({})).toBe('Social post')
    expect(titleForUpload({ fileName: '   ', caption: '  ' })).toBe('Social post')
  })

  it('does not run past what the items API keeps', () => {
    const long = 'word '.repeat(60)
    const title = titleForUpload({ caption: long })
    expect(title.length).toBeLessThanOrEqual(MAX_ITEM_TITLE + 1)
  })
})

describe('what a person is told before they press anything', () => {
  it('an account manager is told nothing waits for approval', () => {
    expect(uploadOutcomeLine(true)).toContain('Nothing waits for approval')
  })

  it('everybody else is told who checks it — and it is not a refusal', () => {
    const line = uploadOutcomeLine(false)
    expect(line).toContain('account manager checks it')
    expect(line.toLowerCase()).not.toContain('cannot')
  })
})

describe('files off the desktop', () => {
  it('knows a drag carrying real files from one carrying a tile', () => {
    expect(isFileDrag(['Files'])).toBe(true)
    expect(isFileDrag(['application/x-md-item', 'text/plain'])).toBe(false)
    expect(isFileDrag(null)).toBe(false)
  })

  it('keeps photos and video and says which files it could not use', () => {
    const { keep, refused } = usableUploadFiles([
      { name: 'a.jpg', type: 'image/jpeg' },
      { name: 'notes.pdf', type: 'application/pdf' },
      { name: 'b.mp4', type: 'video/mp4' },
    ])
    expect(keep.map(f => f.name)).toEqual(['a.jpg', 'b.mp4'])
    expect(refusedFilesLine(refused)).toBe('notes.pdf is not a photo or a video.')
  })

  it('says nothing when every file was usable', () => {
    expect(refusedFilesLine([])).toBeNull()
  })
})
