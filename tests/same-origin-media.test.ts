import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { isSameOriginMedia, sameOriginVideoUrl } from '../app/lib/same-origin-media-core'

/** THE COVER PICKER READS OUR OWN VIDEOS ON OUR OWN ORIGIN (22 Sep 2026: "this video will not open here"). */
describe('a video from our bucket, on our own origin', () => {
  it('a bucket file goes through the stream route; anything else is left alone', () => {
    const own = 'https://pub-e66dd091eb38427e8eaca82bde7082ef.r2.dev/1789723893251-ex1ng7-MD_BTS.mp4'
    expect(sameOriginVideoUrl(own)).toBe(`/api/assets/stream?url=${encodeURIComponent(own)}`)
    expect(sameOriginVideoUrl('https://videodelivery.net/abc/manifest.m3u8')).toBe('https://videodelivery.net/abc/manifest.m3u8')
    expect(sameOriginVideoUrl('not a url')).toBe('not a url')
    expect(isSameOriginMedia(sameOriginVideoUrl(own))).toBe(true)
    expect(isSameOriginMedia(own)).toBe(false)
  })
  it('the route is a signed-in, own-storage, Range-passing GET; the picker uses it and drops cross-origin mode for it', () => {
    const route = readFileSync('app/api/assets/stream/route.ts', 'utf8')
    expect(route).toContain('await requireSignedIn()')
    expect(route).toContain("if (!isOwnAssetUrl(url, bases)) return new Response('Not found', { status: 404 })")
    expect(route).toContain("headers: range ? { Range: range } : {}")
    expect(route).not.toMatch(/method: '(POST|PUT|DELETE)'/)
    const picker = readFileSync('app/dashboard/social/schedule/CoverPicker.tsx', 'utf8')
    expect(picker).toContain('const src = sameOriginVideoUrl(playable(videoUrl))')
    expect(picker).toContain("if (!isSameOriginMedia(src)) el.crossOrigin = 'anonymous'")
  })
})
