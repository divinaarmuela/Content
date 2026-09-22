import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { PUBLIC_THUMBNAIL, publicFileEntry } from '../app/lib/drive-public-file-core'

/**
 * A DRIVE FILE OUR ACCOUNT CANNOT SEE IS DESCRIBED AS ANYONE WITH THE LINK
 * (22 Sep 2026: a Glass Den clip's link on a post card gave "Google Drive 404").
 * Read live before this: the account lists that folder only through the public
 * view, every by-id call 404s, the listing has no resource key — and a stranger
 * gets the name and size from the download headers and a picture from the
 * public thumbnail address.
 */
describe('a link-shared Drive file, as anyone with the link', () => {
  it('the public thumbnail address, sized within what Google draws', () => {
    expect(PUBLIC_THUMBNAIL('14I9T3hpg_ia-flJKh5OqU0SAvOIvpPbj', 400)).toBe('https://drive.google.com/thumbnail?id=14I9T3hpg_ia-flJKh5OqU0SAvOIvpPbj&sz=w400')
    expect(PUBLIC_THUMBNAIL('x', 99999)).toContain('sz=w2048')
    expect(PUBLIC_THUMBNAIL('x', 0)).toContain('sz=w16')
  })

  it('the entry the pages draw, from the download headers', () => {
    const e = publicFileEntry('14I9T3hpg_ia-flJKh5OqU0SAvOIvpPbj', { name: 'Glass_Den 3.mov', mime: 'video/quicktime', size: 175509901, modified: null })
    expect(e).toMatchObject({ id: '14I9T3hpg_ia-flJKh5OqU0SAvOIvpPbj', name: 'Glass_Den 3.mov', mimeType: 'video/quicktime', size: 175509901, hasThumbnail: true, ownerName: null, parents: [] })
    expect(e.webViewLink).toBe('https://drive.google.com/file/d/14I9T3hpg_ia-flJKh5OqU0SAvOIvpPbj/view')
    expect(publicFileEntry('abc', { name: '', mime: '', size: null, modified: null })).toMatchObject({ name: 'abc', mimeType: 'application/octet-stream' })
  })

  it('the info route falls back to the public headers, and the thumbnail route to the public picture', () => {
    const info = readFileSync('app/api/drive/info/route.ts', 'utf8')
    expect(info).toContain('const meta = await driveFileMeta(id)')
    expect(info).toContain("return NextResponse.json({ entry: publicFileEntry(id, meta), mirror: null, poster: null, source: 'public' })")
    const thumb = readFileSync('app/api/drive/thumbnail/route.ts', 'utf8')
    expect(thumb).toContain("const pub = await fetch(PUBLIC_THUMBNAIL(id, want), { cache: 'no-store' }).catch(() => null)")
    expect(thumb).toContain("if (!pub || !pub.ok || !pub.body || !type.startsWith('image/')) {")
    // still read only (trap 13): two GETs, nothing else
    expect(info).not.toMatch(/method: '(POST|PATCH|PUT|DELETE)'/)
    expect(thumb).not.toMatch(/method: '(POST|PATCH|PUT|DELETE)'/)
  })
})
