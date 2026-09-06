/**
 * Pinterest pins on the board — the pure half.
 *
 * The fixtures are real captures from 2026-09-06 (see the comment at the
 * top of each): a video pin, an image pin, and the oEmbed answer. What
 * Pinterest serves is unusual enough to pin down — the `og:` tags sit past
 * the 1 MB mark, a video pin has no `og:video`, and the mp4 lives in a
 * relay payload — so the parser is tested against the real thing, not a
 * tidy page we wrote ourselves.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  fromOembed, fromPinterestPageHtml, isPinterestCdnUrl, isPinterestHost, isPinterestShortLink, isSafePreviewUrl,
  mergePreview, oembedUrlFor, pinterestCanonicalUrl, pinterestLargerImage, pinterestPinId, pinterestUsername,
  providerFor,
} from '../app/lib/link-preview-core'
import { mockupPlatformFor, sanitiseCanvasCards, sanitisePreviewFields } from '../app/lib/batch-brief-core'
import { autoplayKindFor, decideAutoplay, playableFileFor } from '../app/lib/board-autoplay-core'

const VIDEO = readFileSync(join(__dirname, 'fixtures/pinterest-pin-video.html'), 'utf8')
const IMAGE = readFileSync(join(__dirname, 'fixtures/pinterest-pin-image.html'), 'utf8')
const OEMBED = JSON.parse(readFileSync(join(__dirname, 'fixtures/pinterest-oembed.json'), 'utf8')) as unknown

const PIN = 'https://www.pinterest.com/pin/424605071145308382/'
const MP4 = 'https://v1.pinimg.com/videos/iht/expMp4/73/7c/64/737c64f1ec9401ae9d71c55877e9a129_720w.mp4'

describe('knowing a Pinterest link', () => {
  it('is Pinterest on every host people paste, including the country hosts and pin.it', () => {
    expect(providerFor(PIN)?.name).toBe('Pinterest')
    expect(providerFor('https://au.pinterest.com/pin/424605071145308382/')?.name).toBe('Pinterest')
    expect(providerFor('https://pin.it/39YYRhN0f')?.name).toBe('Pinterest')
  })

  it('reads the id off every shape their URLs take, and refuses a look-alike host', () => {
    expect(pinterestPinId(PIN)).toBe('424605071145308382')
    expect(pinterestPinId('https://au.pinterest.com/pin/424605071145308382')).toBe('424605071145308382')
    // the og:url shape: words, two dashes, the id
    expect(pinterestPinId('https://au.pinterest.com/pin/good-idea-in-the-school-holidays--49821139624693117/')).toBe('49821139624693117')
    // the hop a pin.it link passes through
    expect(pinterestPinId('https://www.pinterest.com/pin/266556871689003952/sent/?invite_code=80139d28e8a34cb38c105de2e84ac671&sender=762164074346835038&sfo=1'))
      .toBe('266556871689003952')
    expect(pinterestPinId('https://www.pinterest.com/pinterest/')).toBeNull()
    expect(pinterestPinId('https://www.pinterest.com/pin/create/button/?url=x')).toBeNull()
    expect(pinterestPinId('https://pin.it/39YYRhN0f')).toBeNull()
    expect(pinterestPinId('https://pinterest.com.evil.example/pin/424605071145308382/')).toBeNull()
    expect(pinterestPinId('http://www.pinterest.com/pin/424605071145308382/')).toBeNull()
    expect(pinterestPinId('not a url')).toBeNull()
  })

  it('knows a pin.it share code from a pin', () => {
    expect(isPinterestShortLink('https://pin.it/39YYRhN0f')).toBe(true)
    expect(isPinterestShortLink('https://pin.it/4vwU5dJ')).toBe(true)
    expect(isPinterestShortLink('https://pin.it/')).toBe(false)
    expect(isPinterestShortLink(PIN)).toBe(false)
    expect(isPinterestShortLink('https://pin.it.evil.example/abc')).toBe(false)
  })

  it('builds the one page for a pin from the id alone', () => {
    expect(pinterestCanonicalUrl('424605071145308382')).toBe(PIN)
  })

  it('asks the oEmbed, which answers without a key', () => {
    expect(oembedUrlFor(PIN)).toBe(`https://www.pinterest.com/oembed.json?format=json&url=${encodeURIComponent(PIN)}`)
  })
})

describe('the hosts a Pinterest chain may pass through', () => {
  it('is the hosts observed on 2026-09-06 and nothing else', () => {
    for (const ok of [
      'https://pin.it/39YYRhN0f',
      'https://api.pinterest.com/url_shortener/39YYRhN0f/redirect/',
      'https://www.pinterest.com/pin/266556871689003952/sent/?invite_code=x',
      'https://au.pinterest.com/pin/266556871689003952/',
      'https://pinterest.com/pin/1/',
    ]) expect(isPinterestHost(ok), ok).toBe(true)
    for (const no of [
      'http://pin.it/39YYRhN0f',                              // a downgrade
      'https://pinterest.com.evil.example/pin/1/',            // a look-alike
      'https://evil.example/?u=https://www.pinterest.com/',   // Pinterest in the query
      'https://169.254.169.254/latest/meta-data/',            // the metadata service
      'https://pinimg.com/x.jpg',                             // the CDN is not a page host
      'not a url',
    ]) expect(isPinterestHost(no), no).toBe(false)
  })

  it('is on top of the SSRF guard, never instead of it', () => {
    expect(isSafePreviewUrl('https://169.254.169.254/latest/meta-data/')).toBe(false)
    expect(isSafePreviewUrl('https://api.pinterest.com/url_shortener/x/redirect/')).toBe(true)
  })

  it('takes a picture or a film only from Pinterest\'s own CDN, over https', () => {
    expect(isPinterestCdnUrl('https://i.pinimg.com/736x/94/cc/c9/x.jpg')).toBe(true)
    expect(isPinterestCdnUrl(MP4)).toBe(true)
    expect(isPinterestCdnUrl('http://i.pinimg.com/736x/x.jpg')).toBe(false)
    expect(isPinterestCdnUrl('https://pinimg.com.evil.example/x.jpg')).toBe(false)
    expect(isPinterestCdnUrl('https://www.pinterest.com/x.jpg')).toBe(false)
  })
})

describe('what the pin page says', () => {
  it('a video pin: the mp4 a browser plays, the picture, the words and the pinner', () => {
    const p = fromPinterestPageHtml(VIDEO)
    expect(p).toMatchObject({ provider: 'Pinterest', media: 'video', author: '@pinterest', video: MP4 })
    // the page's own og:image (736px), not the 236px tile or the poster frame
    expect(p?.thumb).toBe('https://i.pinimg.com/736x/94/cc/c9/94ccc9ea5a579a414c731ca63c4dabfe.jpg')
    // no og:title on a video pin — the words come from the relay payload
    expect(p?.title?.startsWith('🦕🧊 Dino-mite')).toBe(true)
    expect(p?.title?.length).toBeLessThanOrEqual(200)
  })

  it('prefers H.264 to HEVC, and the widest of those', () => {
    // the capture lists 240w/540w/720w HEVC and a 720w expMp4; only the
    // expMp4 is something every browser plays
    expect(fromPinterestPageHtml(VIDEO)?.video).toContain('/expMp4/')
    expect(fromPinterestPageHtml(VIDEO)?.video).toContain('_720w.mp4')
  })

  it('an image pin: the picture and the title, no film', () => {
    const p = fromPinterestPageHtml(IMAGE)
    expect(p).toEqual({
      title: 'Good idea in the school holidays',
      thumb: 'https://i.pinimg.com/736x/02/56/59/0256591263ca9305da2712cfcfa05180.jpg',
      author: '@pinterest',
      provider: 'Pinterest',
      media: 'image',
    })
  })

  it('a pin that is HLS only is a video with a poster and no file to play', () => {
    const hlsOnly = VIDEO.replace(/https:\/\/v1\.pinimg\.com\/videos\/[^"]*\.mp4/g, 'https://v1.pinimg.com/videos/iht/hls/x.m3u8')
    const p = fromPinterestPageHtml(hlsOnly)
    expect(p?.media).toBe('video')
    expect(p?.video).toBeUndefined()
    expect(p?.thumb).toContain('i.pinimg.com')
  })

  it('never takes a film or a picture from anywhere but pinimg.com', () => {
    const swapped = VIDEO
      .replace(/https:\/\/v1\.pinimg\.com/g, 'https://evil.example')
      .replace(/https:\/\/i\.pinimg\.com/g, 'https://evil.example')
    const p = fromPinterestPageHtml(swapped)
    expect(p?.video).toBeUndefined()
    expect(p?.thumb).toBeUndefined()
  })

  it('reads the meta tags alone when there is no relay payload', () => {
    const metaOnly = IMAGE.replace(/<script[\s\S]*?<\/script>/g, '')
    const p = fromPinterestPageHtml(metaOnly)
    expect(p?.thumb).toContain('/736x/')
    expect(p?.title).toContain('Good idea in the school holidays')
    expect(p?.author).toBeUndefined()
  })

  it('says nothing about a page it does not understand', () => {
    expect(fromPinterestPageHtml('<html><head><title>Pinterest</title></head><body></body></html>')).toBeNull()
    expect(fromPinterestPageHtml('')).toBeNull()
  })
})

describe('what the oEmbed says', () => {
  it('the words, the pinner as a handle from the profile URL, and the picture at card size', () => {
    const p = fromOembed(OEMBED, PIN)
    expect(p.provider).toBe('Pinterest')
    expect(p.author).toBe('@pinterest')
    expect(p.title?.startsWith('🦕🧊 Dino-mite')).toBe(true)
    // 236px is a tile; the 736px rendition is the one og:image itself uses
    expect(p.thumb).toBe('https://i.pinimg.com/736x/94/cc/c9/94ccc9ea5a579a414c731ca63c4dabfe.jpg')
    // oEmbed cannot tell a video pin from a picture ("rich" for both)
    expect(p.media).toBe('image')
  })

  it('reads the username only off a profile URL on Pinterest', () => {
    expect(pinterestUsername('https://www.pinterest.com/pinterest/')).toBe('pinterest')
    expect(pinterestUsername('https://au.pinterest.com/some.user-1')).toBe('some.user-1')
    expect(pinterestUsername('https://www.pinterest.com/pin/1/')).toBeUndefined()
    expect(pinterestUsername('https://evil.example/pinterest/')).toBeUndefined()
    expect(pinterestUsername('')).toBeUndefined()
  })

  it('only resizes a pinimg.com picture', () => {
    expect(pinterestLargerImage('https://i.pinimg.com/236x/a/b/c/d.jpg')).toBe('https://i.pinimg.com/736x/a/b/c/d.jpg')
    expect(pinterestLargerImage('https://i.pinimg.com/736x/a/b/c/d.jpg')).toBe('https://i.pinimg.com/736x/a/b/c/d.jpg')
    expect(pinterestLargerImage('https://evil.example/236x/d.jpg')).toBe('https://evil.example/236x/d.jpg')
  })
})

describe('merging', () => {
  it('a film makes the post a video whatever the oEmbed thought, and the page\'s picture wins', () => {
    const merged = mergePreview(fromPinterestPageHtml(VIDEO), fromOembed(OEMBED, PIN))
    expect(merged?.media).toBe('video')
    expect(merged?.video).toBe(MP4)
    expect(merged?.thumb).toContain('/736x/')
    expect(merged?.author).toBe('@pinterest')
  })
  it('a film alone is worth storing', () => {
    expect(mergePreview({ video: MP4 })).toEqual({ video: MP4, media: 'video' })
  })
})

describe('the card', () => {
  it('a pin, or a pin.it code, goes into the Pinterest frame', () => {
    expect(mockupPlatformFor(PIN)).toBe('pinterest')
    expect(mockupPlatformFor('https://au.pinterest.com/pin/424605071145308382/')).toBe('pinterest')
    expect(mockupPlatformFor('https://pin.it/39YYRhN0f')).toBe('pinterest')
  })

  it('stores the film through the same https-only gate as the picture, on a link card and inside a mock-up', () => {
    expect(sanitisePreviewFields({ video: MP4, thumb: 'https://i.pinimg.com/736x/x.jpg' })).toEqual({ video: MP4, thumb: 'https://i.pinimg.com/736x/x.jpg' })
    expect(sanitisePreviewFields({ video: 'http://v1.pinimg.com/x.mp4' })).toEqual({})
    expect(sanitisePreviewFields({ video: 'javascript:alert(1)' })).toEqual({})
    const [link] = sanitiseCanvasCards([{ id: 'l', kind: 'link', x: 0, y: 0, w: 240, z: 1, url: PIN, video: MP4, provider: 'Pinterest', media: 'video' }])
    expect(link.video).toBe(MP4)
    const [mock] = sanitiseCanvasCards([{ id: 'm', kind: 'mockup', platform: 'pinterest', x: 0, y: 0, w: 236, z: 1, link_url: PIN, preview: { video: MP4, thumb: 'https://i.pinimg.com/736x/x.jpg' } }])
    expect(mock.platform).toBe('pinterest')
    expect(mock.preview?.video).toBe(MP4)
  })

  it('a pin with a film is a <video> that plays by itself; a picture pin is a still', () => {
    expect(playableFileFor({ url: PIN, video: MP4 })).toBe(MP4)
    expect(playableFileFor({ url: PIN })).toBeNull()
    expect(playableFileFor({ url: 'https://r2.example.com/clip.mp4', video: MP4 })).toBe('https://r2.example.com/clip.mp4')
    expect(autoplayKindFor({ kind: 'link', url: PIN, video: MP4 })).toBe('file')
    expect(autoplayKindFor({ kind: 'link', url: PIN, media: 'video' })).toBe('none')
    expect(autoplayKindFor({ kind: 'link', url: PIN, media: 'image' })).toBe('none')
    // and it follows the same rules as our own files: near before it loads,
    // chosen before it plays, never for a viewer who asked for less motion
    expect(decideAutoplay({ kind: 'file', reducedMotion: false, near: true, chosen: true })).toEqual({ load: true, play: true })
    expect(decideAutoplay({ kind: 'file', reducedMotion: true, near: true, chosen: true })).toEqual({ load: false, play: false })
  })
})
