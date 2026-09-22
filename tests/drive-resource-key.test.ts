import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { isResourceKey, resourceKeyHeader } from '../app/lib/files-core'
import { driveFileFromEntry, driveResourceKeyFromLink, driveStreamUrl, driveThumbnailUrl, sanitiseDriveFiles } from '../app/lib/canvas-drive-core'

describe('a link-shared Drive file is fetched by id WITH its resource key (22 Sep 2026)', () => {
  it('the header Google wants, only for a well-formed key', () => {
    expect(resourceKeyHeader('1abc', '0-AbC_d')).toEqual({ 'X-Goog-Drive-Resource-Keys': '1abc/0-AbC_d' })
    expect(resourceKeyHeader('1abc', null)).toEqual({})
    expect(resourceKeyHeader('1abc', 'bad key!')).toEqual({})
    expect(isResourceKey('0-AbC_d')).toBe(true)
    expect(isResourceKey('')).toBe(false)
  })
  it('the post card keeps the key from the listing or the pasted link, and sends it on every by-id address', () => {
    const f = driveFileFromEntry({ id: '14I9T3hpg_ia-flJKh5OqU0SAvOIvpPbj', name: 'Glass_Den 3.mov', mimeType: 'video/quicktime', resourceKey: '0-k3y' })!
    expect(f.key).toBe('0-k3y')
    expect(sanitiseDriveFiles([f])[0].key).toBe('0-k3y')
    expect(sanitiseDriveFiles([{ ...f, key: 'no spaces!' }])[0].key).toBeUndefined()
    expect(driveThumbnailUrl(f.id, 800, f.key)).toContain('&key=0-k3y')
    expect(driveStreamUrl(f)).toContain('&key=0-k3y')
    expect(driveResourceKeyFromLink('https://drive.google.com/file/d/14I9T3hpg_ia-flJKh5OqU0SAvOIvpPbj/view?usp=drivesdk&resourcekey=0-abc')).toBe('0-abc')
    expect(driveResourceKeyFromLink('https://drive.google.com/file/d/14I9T3hpg_ia-flJKh5OqU0SAvOIvpPbj/view?usp=drivesdk')).toBeNull()
  })
  it('the listing asks Google for the key, and every by-id route takes it', () => {
    expect(readFileSync('app/lib/gdrive-files.ts', 'utf8')).toContain("'id,name,mimeType,size,modifiedTime,webViewLink,hasThumbnail,resourceKey,owners(displayName,emailAddress)'")
    for (const r of ['info', 'thumbnail', 'stream', 'download']) expect(readFileSync(`app/api/drive/${r}/route.ts`, 'utf8')).toContain('isResourceKey(')
  })
})
