import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { disposition, downloadHref, isOwnAssetUrl, ownStorageBases, OWN_STORAGE_DEFAULT } from '../app/lib/download-core'

describe('download-core — a Download on every asset (17 Sep 2026)', () => {
  it('knows our own storage from the environment, with the public bucket as the floor', () => {
    expect(ownStorageBases({})).toEqual([OWN_STORAGE_DEFAULT])
    expect(ownStorageBases({ R2_PUBLIC_BASE_URL: 'https://media.mdm.au/', NEXT_PUBLIC_MEDIA_URL: 'https://media.mdm.au' }))
      .toEqual(['https://media.mdm.au', OWN_STORAGE_DEFAULT])
    const bases = ownStorageBases({ R2_PUBLIC_BASE_URL: 'https://media.mdm.au' })
    expect(isOwnAssetUrl('https://media.mdm.au/social/a.png', bases)).toBe(true)
    expect(isOwnAssetUrl(`${OWN_STORAGE_DEFAULT}/x.mp4`, bases)).toBe(true)
    expect(isOwnAssetUrl('https://evil.example/media.mdm.au/a.png', bases)).toBe(false)
    expect(isOwnAssetUrl('http://media.mdm.au/a.png', bases)).toBe(false)
  })

  it('a copy downloads through our route; a Drive original through the Files page route; nothing otherwise', () => {
    expect(downloadHref({ url: 'https://media.mdm.au/social/a b.png', name: 'a b.png' }))
      .toBe('/api/assets/download?url=https%3A%2F%2Fmedia.mdm.au%2Fsocial%2Fa+b.png&name=a+b.png')
    expect(downloadHref({ url: 'https://media.mdm.au/a.png', name: 'a.png' }, 'ab'.repeat(16)))
      .toContain('&share=abababababababababababababababab')
    expect(downloadHref({ id: '1lbLSNbYXOn3Vbyk0abcdefghijklmnop', name: 'raw.mov' })).toBe('/api/drive/download?id=1lbLSNbYXOn3Vbyk0abcdefghijklmnop')
    expect(downloadHref({ name: 'x' })).toBeNull()
  })

  it('the attachment header is safe and keeps the real name', () => {
    expect(disposition('Spring "reel" ✨.mp4')).toBe(`attachment; filename="Spring _reel_ _.mp4"; filename*=UTF-8''Spring%20%22reel%22%20%E2%9C%A8.mp4`)
    expect(disposition('')).toContain('filename="file"')
  })

  it('the tiles on the card carry it — the work-from files, the folder tiles and the copies', () => {
    const work = readFileSync('app/dashboard/board/FilesToWorkFrom.tsx', 'utf8')
    expect(work).toContain("import { downloadHref } from '../../lib/download-core'")
    expect(work).toMatch(/href=\{downloadHref\(f\) \?\? f\.url\} download\b/)
    const folder = readFileSync('app/dashboard/board/DriveFolderFiles.tsx', 'utf8')
    expect(folder).toContain("import { downloadHref } from '../../lib/download-core'")
    expect(folder).toContain('const dl = downloadHref(isCopy(t) ? { url: t.open, name: t.name } : { id: t.id, name: t.name })')
    expect(folder).toMatch(/\{dl && \(\s*<a href=\{dl\} download/)
    const route = readFileSync('app/api/assets/download/route.ts', 'utf8')
    expect(route).toContain('await requireSignedIn()')
    expect(route).toContain('if (!isOwnAssetUrl(url, bases)) return Response.redirect(url, 302)')
  })
})
