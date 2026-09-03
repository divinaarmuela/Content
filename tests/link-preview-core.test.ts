import { describe, it, expect } from 'vitest'
import {
  displayHost, embedUrlFor, fromMetaTags, fromOembed, isPlayableFile, isSafePreviewUrl, mergePreview,
  oembedUrlFor, offlinePreview, parseMetaTags, providerFor, youtubeId,
} from '../app/lib/link-preview-core'

describe('refusing to fetch our own network', () => {
  // this request leaves OUR server, so the guard is a security control and not
  // a nicety: a text field must not become a way to read the metadata service
  it('blocks loopback, link-local and the private ranges', () => {
    for (const bad of [
      'https://localhost/x',
      'https://127.0.0.1/x',
      'https://169.254.169.254/latest/meta-data/',   // the cloud metadata service
      'https://10.0.0.5/x',
      'https://172.16.4.4/x',
      'https://172.31.255.1/x',
      'https://192.168.1.1/x',
      'https://0.0.0.0/x',
      'https://[::1]/x',
      'https://intranet/x',                          // no dot = an internal name
      'https://build.internal/x',
    ]) {
      expect(isSafePreviewUrl(bad), bad).toBe(false)
    }
  })

  it('blocks anything that is not https, including a downgrade', () => {
    expect(isSafePreviewUrl('http://example.com')).toBe(false)
    expect(isSafePreviewUrl('file:///etc/passwd')).toBe(false)
    expect(isSafePreviewUrl('javascript:alert(1)')).toBe(false)
    expect(isSafePreviewUrl('not a url')).toBe(false)
  })

  it('lets an ordinary public link through, including the 172 addresses that are public', () => {
    expect(isSafePreviewUrl('https://www.youtube.com/watch?v=abc')).toBe(true)
    expect(isSafePreviewUrl('https://172.15.0.1/x')).toBe(true)
    expect(isSafePreviewUrl('https://172.32.0.1/x')).toBe(true)
  })
})

describe('what we can know without asking anyone', () => {
  // the commonest case resolves instantly and keeps working when the provider
  // blocks us, which is most of the value here
  it('reads a YouTube id out of every shape YouTube hands out', () => {
    expect(youtubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(youtubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(youtubeId('https://www.youtube.com/shorts/abc123XYZ')).toBe('abc123XYZ')
    expect(youtubeId('https://m.youtube.com/watch?v=abc123XYZ&t=30')).toBe('abc123XYZ')
    expect(youtubeId('https://www.youtube.com/embed/abc123XYZ')).toBe('abc123XYZ')
    expect(youtubeId('https://vimeo.com/12345')).toBeNull()
  })

  it('builds a Short preview from the URL alone', () => {
    const p = offlinePreview('https://www.youtube.com/shorts/abc123XYZ')!
    expect(p.provider).toBe('YouTube')
    expect(p.media).toBe('video')
    expect(p.thumb).toBe('https://i.ytimg.com/vi/abc123XYZ/hqdefault.jpg')
  })

  it('knows nothing offline about the rest, and says so rather than guessing', () => {
    expect(offlinePreview('https://www.instagram.com/reel/Cxyz/')).toBeNull()
    expect(offlinePreview('https://example.com/blog')).toBeNull()
  })
})

describe('knowing which platform a link belongs to', () => {
  it('matches on the registrable tail, so subdomains count', () => {
    expect(providerFor('https://m.youtube.com/watch?v=a')?.name).toBe('YouTube')
    expect(providerFor('https://vm.tiktok.com/ZMabc/')?.name).toBe('TikTok')
    expect(providerFor('https://www.instagram.com/reel/Cxyz/')?.name).toBe('Instagram')
    expect(providerFor('https://x.com/someone/status/1')?.name).toBe('X')
    expect(providerFor('https://example.com')).toBeNull()
  })

  it('only asks an oEmbed endpoint that answers without a key', () => {
    expect(oembedUrlFor('https://www.youtube.com/watch?v=a')).toContain('youtube.com/oembed')
    expect(oembedUrlFor('https://www.tiktok.com/@a/video/1')).toContain('tiktok.com/oembed')
    expect(oembedUrlFor('https://example.com')).toBeNull()
  })

  it('asks Meta for Instagram again — tokenless since 15 June 2026', () => {
    // this file was first written assuming Instagram could never resolve,
    // because Meta put oEmbed behind an app token and App Review in 2020.
    // That was reversed for public posts; the pinned version keeps us off
    // whatever Graph ships next.
    const ig = oembedUrlFor('https://www.instagram.com/reel/Cxyz/')!
    expect(ig).toContain('graph.facebook.com/v25.0/instagram_oembed')
    expect(ig).toContain('omitscript=true')
    expect(ig).not.toContain('access_token')
  })

  it('sends the app token when there is one, and never invents one', () => {
    // a token is optional and only raises the rate limit
    expect(oembedUrlFor('https://www.instagram.com/reel/Cxyz/', 'abc|123'))
      .toContain('access_token=abc%7C123')
    expect(oembedUrlFor('https://www.youtube.com/watch?v=a', 'abc|123'))
      .not.toContain('access_token')
  })
})

describe('reading a page that was written for a crawler', () => {
  const html = `
    <html><head>
      <title>Fallback &amp; title</title>
      <meta property="og:title" content="Behind the &quot;scenes&quot;">
      <meta property="og:image" content="https://cdn.example.com/cover.jpg">
      <meta property="og:type" content="video">
      <meta property="og:site_name" content="Example">
    </head></html>`

  it('pulls the tags out and decodes what HTML did to them', () => {
    const tags = parseMetaTags(html)
    expect(tags['og:title']).toBe('Behind the "scenes"')
    expect(tags['og:image']).toBe('https://cdn.example.com/cover.jpg')
  })

  it('falls back to <title> when there is no og:title', () => {
    expect(parseMetaTags('<html><head><title>Just a &amp; page</title></head>')['og:title'])
      .toBe('Just a & page')
  })

  it('survives a malformed document rather than throwing', () => {
    expect(parseMetaTags('<meta property=og:title content=unquoted>')).toEqual({})
    expect(parseMetaTags('')).toEqual({})
  })

  it('reads og:type video as a video, so the card wears a play badge', () => {
    expect(fromMetaTags(parseMetaTags(html), 'https://example.com/x').media).toBe('video')
  })

  it('refuses a thumbnail that points back inside our network', () => {
    const evil = parseMetaTags('<meta property="og:image" content="http://169.254.169.254/token">')
    expect(fromMetaTags(evil, 'https://example.com/x').thumb).toBeUndefined()
  })
})

describe('oEmbed, where the provider still answers', () => {
  it('takes the thumbnail and the title', () => {
    const p = fromOembed(
      { title: 'A dance', thumbnail_url: 'https://p16.tiktokcdn.com/x.jpg', author_name: 'someone' },
      'https://www.tiktok.com/@a/video/1',
    )
    expect(p).toEqual({
      title: 'A dance',
      thumb: 'https://p16.tiktokcdn.com/x.jpg',
      provider: 'TikTok',
      media: 'video',
    })
  })

  it('falls back to the author when a post has no title of its own', () => {
    const p = fromOembed({ author_name: 'someone' }, 'https://www.tiktok.com/@a/video/1')
    expect(p.title).toBe('someone')
  })

  it('does not fall over on a provider that answers with nonsense', () => {
    expect(() => fromOembed(null, 'https://example.com')).not.toThrow()
    expect(fromOembed('nope', 'https://example.com').thumb).toBeUndefined()
  })
})

describe('merging what we learned', () => {
  it('prefers the earlier source for each field, and fills the gaps from later ones', () => {
    expect(mergePreview(
      { thumb: 'https://a/1.jpg', provider: 'YouTube', media: 'video' },
      { thumb: 'https://b/2.jpg', title: 'The title' },
    )).toEqual({ thumb: 'https://a/1.jpg', provider: 'YouTube', media: 'video', title: 'The title' })
  })

  it('lets a later source upgrade "page" to what it really is', () => {
    expect(mergePreview({ title: 'x', media: 'page' }, { media: 'video' })?.media).toBe('video')
  })

  // a provider chip and no picture is not a preview — it is the chip we
  // already had, wearing a new field
  it('returns nothing when nothing was learned', () => {
    expect(mergePreview(null, undefined)).toBeNull()
    expect(mergePreview({ provider: 'Instagram', media: 'video' })).toBeNull()
  })
})

describe('displayHost', () => {
  it('drops the www so the card reads like a name', () => {
    expect(displayHost('https://www.instagram.com/reel/Cxyz/')).toBe('instagram.com')
    expect(displayHost('nonsense')).toBe('nonsense')
  })
})

describe('playing the thing in place', () => {
  // the goal is a board where any social link renders as what it actually is,
  // so these URLs are built by us from the id rather than taken from oEmbed's
  // `html` — that field carries a script tag, and putting a provider's markup
  // into our page is a bigger decision than playing a video
  it('embeds the platforms that publish a plain iframe URL', () => {
    expect(embedUrlFor('https://www.youtube.com/shorts/abc123XYZ'))
      .toBe('https://www.youtube-nocookie.com/embed/abc123XYZ?autoplay=1&rel=0')
    expect(embedUrlFor('https://vimeo.com/12345678'))
      .toBe('https://player.vimeo.com/video/12345678?autoplay=1')
    expect(embedUrlFor('https://www.instagram.com/reel/Cabc123/'))
      .toBe('https://www.instagram.com/p/Cabc123/embed/captioned/')
    expect(embedUrlFor('https://www.instagram.com/p/Cabc123/?igsh=xyz'))
      .toBe('https://www.instagram.com/p/Cabc123/embed/captioned/')
    expect(embedUrlFor('https://www.tiktok.com/@someone/video/7412345678901234567'))
      .toBe('https://www.tiktok.com/embed/v2/7412345678901234567')
    expect(embedUrlFor('https://www.facebook.com/page/posts/123'))
      .toContain('facebook.com/plugins/post.php?href=')
  })

  it('refuses a link it cannot turn into a frame, rather than one that renders nothing', () => {
    // a vm.tiktok.com short link has no video id until it is followed, and a
    // play button that opens an empty frame is worse than no play button
    expect(embedUrlFor('https://vm.tiktok.com/ZMabc/')).toBeNull()
    expect(embedUrlFor('https://www.instagram.com/someaccount/')).toBeNull()
    expect(embedUrlFor('https://www.pinterest.com/pin/123/')).toBeNull()
    expect(embedUrlFor('https://example.com/article')).toBeNull()
    expect(embedUrlFor('not a url')).toBeNull()
  })

  it('knows one of our own uploads from a picture', () => {
    // a dropped .mp4 was an image card rendering an <img> — a broken picture
    // on the board, with nothing to say why
    expect(isPlayableFile('https://cdn.example.com/a.mp4')).toBe(true)
    expect(isPlayableFile('https://cdn.example.com/a.MOV?v=2')).toBe(true)
    expect(isPlayableFile('https://cdn.example.com/a.webm')).toBe(true)
    expect(isPlayableFile('https://cdn.example.com/a.jpg')).toBe(false)
  })
})
