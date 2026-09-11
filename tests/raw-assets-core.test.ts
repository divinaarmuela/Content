import { describe, expect, it } from 'vitest'
import {
  FILES_TO_WORK_FROM, filesToWorkFromWords, mergeRawAssets, nameFromUrl, rawAssetKind, readRawAssets, withoutRawAsset,
} from '../app/lib/raw-assets-core'

/* ── the files a manager hands the editor to work from (11 Sep 2026) ── */

describe('raw assets on a card', () => {
  it('reads the stored list tolerantly and keeps only https files', () => {
    expect(readRawAssets(null)).toEqual([])
    expect(readRawAssets([{ url: 'https://r2/a.mov', name: 'a.mov' }, { url: 'http://x/y' }, 'junk', { name: 'no url' }]))
      .toEqual([{ url: 'https://r2/a.mov', name: 'a.mov' }])
  })

  it('adds without repeating a file, and names a nameless one from its url', () => {
    const merged = mergeRawAssets(
      [{ url: 'https://r2/a.mov', name: 'a.mov' }],
      [{ url: 'https://r2/a.mov', name: 'again' }, { url: 'https://r2/clips/DSC%20123.jpg', name: '' }],
    )
    expect(merged).toEqual([{ url: 'https://r2/a.mov', name: 'a.mov' }, { url: 'https://r2/clips/DSC%20123.jpg', name: 'DSC 123.jpg' }])
    expect(withoutRawAsset(merged, 'https://r2/a.mov')).toEqual([merged[1]])
    expect(nameFromUrl('not a url')).toBe('not a url')
  })

  it('knows a picture from a clip for the thumbnail', () => {
    expect(rawAssetKind({ url: 'https://r2/x', name: 'IMG_1.JPG' })).toBe('image')
    expect(rawAssetKind({ url: 'https://r2/clip.mov?sig=1', name: '' })).toBe('video')
    expect(rawAssetKind({ url: 'https://r2/notes.pdf', name: 'notes.pdf' })).toBe('other')
  })

  it('says how much there is to work from, in plain words', () => {
    expect(FILES_TO_WORK_FROM).toBe('Files to work from')
    expect(filesToWorkFromWords(0, false)).toMatch(/^Nothing yet/)
    expect(filesToWorkFromWords(1, false)).toBe('1 file to work from.')
    expect(filesToWorkFromWords(3, true)).toBe('3 files and a folder link to work from.')
    expect(filesToWorkFromWords(0, true)).toBe('a folder link to work from.')
  })
})
