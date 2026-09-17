import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SITE_STREAM, siteFileOf, siteStream } from '../app/lib/site-stream-core'

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n')

describe('the site’s clips on Stream (17 Sep 2026)', () => {
  it('a clip in the map plays from Stream with its still; one that is not plays as before', () => {
    expect(siteFileOf('https://pub-e66dd091eb38427e8eaca82bde7082ef.r2.dev/hero-spec-ad.mp4')).toBe('hero-spec-ad.mp4')
    expect(siteFileOf('https://x.test/a%20b.mp4?v=2')).toBe('a b.mp4')
    const s = siteStream('https://pub-e66dd091eb38427e8eaca82bde7082ef.r2.dev/Pattons.mp4')
    expect(s?.hls).toBe(`https://customer-g32uhnka70ibwlas.cloudflarestream.com/${SITE_STREAM['Pattons.mp4']}/manifest/video.m3u8`)
    expect(s?.poster).toContain('/thumbnails/thumbnail.jpg')
    expect(siteStream('https://pub-e66dd091eb38427e8eaca82bde7082ef.r2.dev/not-there.mp4')).toBeNull()
    expect(siteStream(null)).toBeNull()
  })
  it('every clip the site plays is in the map, and SiteMedia looks it up itself', () => {
    const played = new Set<string>()
    for (const f of ['app/components/lama/LamaServices.tsx', 'app/components/lama/LamaWorkRows.tsx', 'app/work/WorkGrid.tsx', 'app/lib/work-core.ts'].filter(p => { try { readFileSync(join(process.cwd(), p)); return true } catch { return false } })) {
      for (const m of src(f).matchAll(/media\('([^']+\.(?:mp4|mov|webm))'\)/g)) played.add(m[1])
    }
    for (const f of played) expect(SITE_STREAM[f], `${f} is not on Stream — ask /api/stream/preview for it and add its id`).toBeTruthy()
    const media = src('app/components/SiteMedia.tsx')
    expect(media).toContain('const known = hls === undefined && isVideoUrl(src) ? siteStream(src) : null')
    expect(media).toContain('src={stream ? undefined : src}')
  })
})
