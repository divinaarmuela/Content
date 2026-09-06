import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  displayHost, embedUrlFor, fromInstagramEmbedHtml, fromMetaTags, fromOembed, instagramEmbedPageUrl,
  instagramShortcode, isInstagramCdnUrl, isPlayableFile, isSafePreviewUrl, isTikTokShortLink, mergePreview,
  oembedUrlFor, offlinePreview, parseMetaTags, providerFor, tiktokCanonicalUrl, tiktokVideoId, youtubeId,
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

  it('does not ask Meta without a token — verified 2026-09-06, it answers 403 "(#200) Provide valid app ID"', () => {
    // an earlier comment here claimed Meta's oEmbed had opened up in June
    // 2026; the real endpoint says otherwise, and a 403 we wait on is worse
    // than a call we never make. Without META_OEMBED_TOKEN the route reads
    // the public embed page instead.
    expect(oembedUrlFor('https://www.instagram.com/reel/Cxyz/')).toBeNull()
    expect(oembedUrlFor('https://www.threads.net/@a/post/Cxyz')).toBeNull()
  })

  it('asks Meta with the app token when there is one, pinned to v25.0, and never invents one', () => {
    const ig = oembedUrlFor('https://www.instagram.com/reel/Cxyz/', 'abc|123')!
    expect(ig).toContain('graph.facebook.com/v25.0/instagram_oembed')
    expect(ig).toContain('access_token=abc%7C123')
    expect(ig).toContain('omitscript=true')
    expect(oembedUrlFor('https://www.youtube.com/watch?v=a', 'abc|123'))
      .not.toContain('access_token')
  })
})

describe("Instagram's public embed page — the source that needs no app", () => {
  const captioned = readFileSync(join(__dirname, 'fixtures/instagram-embed-captioned.html'), 'utf8')
  const broken = readFileSync(join(__dirname, 'fixtures/instagram-embed-broken.html'), 'utf8')

  it('finds the shortcode under every link shape people paste, query and trailing slash or not', () => {
    for (const u of [
      'https://www.instagram.com/p/Dbqg-OzRmcw/',
      'https://www.instagram.com/p/Dbqg-OzRmcw',
      'https://instagram.com/p/Dbqg-OzRmcw/?igsh=MTc4bXh0NzU2NQ==',
      'https://www.instagram.com/reel/Dbqg-OzRmcw/?utm_source=ig_web_copy_link&utm_campaign=x',
      'https://www.instagram.com/reels/Dbqg-OzRmcw/',
      'https://www.instagram.com/tv/Dbqg-OzRmcw/',
    ]) {
      expect(instagramShortcode(u), u).toBe('Dbqg-OzRmcw')
      expect(instagramEmbedPageUrl(u), u).toBe('https://www.instagram.com/p/Dbqg-OzRmcw/embed/captioned/')
    }
  })

  it('refuses a profile, a look-alike host, and nonsense', () => {
    expect(instagramShortcode('https://www.instagram.com/someaccount/')).toBeNull()
    expect(instagramShortcode('https://www.instagram.com.evil.example/p/Dbqg-OzRmcw/')).toBeNull()
    expect(instagramShortcode('https://www.instagram.com/p/../embed/')).toBeNull()
    expect(instagramEmbedPageUrl('nonsense')).toBeNull()
  })

  it('reads the picture and the caption out of a served post', () => {
    // the real page for https://www.instagram.com/p/Da7nMMNS2PY/embed/captioned/
    // as served to us on 2026-09-06
    const p = fromInstagramEmbedHtml(captioned)!
    expect(p.thumb).toMatch(/^https:\/\/scontent-mel1-1\.cdninstagram\.com\/v\/t51\.82787-15\/750738032_17937325905326353_3589560905606854491_n\.jpg\?stp=dst-jpg_e15_tt6&_nc_cat=109&/)
    expect(p.thumb).not.toContain('&amp;')
    // the username link is Instagram's furniture, not the caption; the
    // numeric entities it writes an @ and an emoji in come back as text
    expect(p.title).toBe('Recent work for @henriettasclt. Their new summer menu deserves all the love.🫶 Just a little nudge to give it a try.☀️')
    expect(p.provider).toBe('Instagram')
    expect(p.media).toBe('video')
    expect(p.embeddable).toBeUndefined()
  })

  it('drops the "View all N comments" tail some captions carry', () => {
    const html = '<div class="Caption"><a class="CaptionUsername" href="/x/">x</a> hello <b>there</b><div class="CaptionComments"><a href="/p/">View all 12 comments</a></div></div>'
    expect(fromInstagramEmbedHtml(html)?.title).toBe('hello there')
  })

  it('reads the older __additionalDataLoaded blob when the markup has nothing', () => {
    const html = `<html><body><script>window.__additionalDataLoaded('extra',{"shortcode_media":{"display_url":"https://scontent.cdninstagram.com/v/pic.jpg?x=1","is_video":false,"edge_media_to_caption":{"edges":[{"node":{"text":"a caption"}}]}}});</script></body></html>`
    expect(fromInstagramEmbedHtml(html)).toEqual({
      title: 'a caption', thumb: 'https://scontent.cdninstagram.com/v/pic.jpg?x=1', provider: 'Instagram', media: 'image',
    })
  })

  it("recognises Instagram's own \"this post may have been removed\" page and says the post cannot be framed", () => {
    // the real page for https://www.instagram.com/p/Dbqg-OzRmcw/embed/captioned/
    // as served to us on 2026-09-06 — this is what the owner's card was
    // showing in its frame, and it must never be a card's face
    expect(broken).toContain('The link to this photo or video may be broken')
    expect(fromInstagramEmbedHtml(broken)).toEqual({ provider: 'Instagram', media: 'video', embeddable: false })
  })

  it('takes a picture only from Instagram\'s and Facebook\'s CDNs, over https', () => {
    const on = (src: string) => captioned.replace(/(class="EmbeddedMediaImage"[^>]*?\bsrc=")[^"]*"/, `$1${src}"`)
    expect(on('https://x.example/a.jpg')).toContain('src="https://x.example/a.jpg"')
    expect(fromInstagramEmbedHtml(on('https://scontent.xx.fbcdn.net/v/a.jpg'))?.thumb).toBe('https://scontent.xx.fbcdn.net/v/a.jpg')
    expect(fromInstagramEmbedHtml(on('https://evil.example/cdninstagram.com/a.jpg'))?.thumb).toBeUndefined()
    expect(fromInstagramEmbedHtml(on('http://scontent.cdninstagram.com/a.jpg'))?.thumb).toBeUndefined()
    expect(fromInstagramEmbedHtml(on('https://cdninstagram.com.evil.example/a.jpg'))?.thumb).toBeUndefined()
    expect(isInstagramCdnUrl('https://scontent-syd2-1.cdninstagram.com/x.jpg')).toBe(true)
    expect(isInstagramCdnUrl('https://instagram.com/x.jpg')).toBe(false)
  })

  it('says nothing about a page it does not understand', () => {
    expect(fromInstagramEmbedHtml('<html><body>login</body></html>')).toBeNull()
    expect(fromInstagramEmbedHtml('')).toBeNull()
  })
})

describe('TikTok share links — a code, not an id', () => {
  it('knows the share short links from the real ones', () => {
    expect(isTikTokShortLink('https://vm.tiktok.com/ZMrRs9oPp/')).toBe(true)
    expect(isTikTokShortLink('https://vt.tiktok.com/ZSabc123/')).toBe(true)
    expect(isTikTokShortLink('https://www.tiktok.com/t/ZTabc123/')).toBe(true)
    expect(isTikTokShortLink('https://www.tiktok.com/@a/video/7290074173500706079')).toBe(false)
    expect(isTikTokShortLink('https://vm.tiktok.com.evil.example/ZMabc/')).toBe(false)
  })

  it('reads the id off every TikTok URL shape their redirects pass through', () => {
    // the real chain for vm.tiktok.com/ZMrRs9oPp/, followed 2026-09-06
    expect(tiktokVideoId('https://m.tiktok.com/v/7290074173500706079.html?_d=x&share_item_id=7290074173500706079'))
      .toBe('7290074173500706079')
    expect(tiktokVideoId('https://www.tiktok.com/@/video/7290074173500706079?_r=1')).toBe('7290074173500706079')
    expect(tiktokVideoId('https://www.tiktok.com/@petsmeowwoof/video/7290074173500706079')).toBe('7290074173500706079')
    expect(tiktokVideoId('https://www.tiktok.com/player/v1/7290074173500706079')).toBe('7290074173500706079')
    expect(tiktokVideoId('https://vm.tiktok.com/ZMrRs9oPp/')).toBeNull()
    expect(tiktokVideoId('https://evil.example/video/7290074173500706079')).toBeNull()
  })

  it('records the canonical URL from oEmbed, so a card can play a link that had no id', () => {
    const p = fromOembed({
      title: 'before sleep talk', thumbnail_url: 'https://p16.tiktokcdn.com/x.jpg',
      author_name: 'Petsmeowwoof', author_url: 'https://www.tiktok.com/@petsmeowwoof',
      author_unique_id: 'petsmeowwoof', embed_product_id: '7290074173500706079',
    }, 'https://vm.tiktok.com/ZMrRs9oPp/')
    expect(p.canonical).toBe('https://www.tiktok.com/@petsmeowwoof/video/7290074173500706079')
    // and not when the pasted link already IS the canonical one
    expect(fromOembed({ embed_product_id: '7290074173500706079', author_unique_id: 'petsmeowwoof' },
      'https://www.tiktok.com/@petsmeowwoof/video/7290074173500706079').canonical).toBeUndefined()
    // an id that is not an id never becomes a URL
    expect(fromOembed({ embed_product_id: '../x', author_unique_id: 'a' }, 'https://vm.tiktok.com/Z/').canonical).toBeUndefined()
    expect(tiktokCanonicalUrl('7290074173500706079', 'not a handle!')).toBe('https://www.tiktok.com/@_/video/7290074173500706079')
  })

  it('the click-to-play frame follows the canonical URL when the pasted one has no id', () => {
    expect(embedUrlFor('https://vm.tiktok.com/ZMrRs9oPp/')).toBeNull()
    expect(embedUrlFor('https://vm.tiktok.com/ZMrRs9oPp/', 'https://www.tiktok.com/@petsmeowwoof/video/7290074173500706079'))
      .toBe('https://www.tiktok.com/embed/v2/7290074173500706079')
    // a canonical URL on some other host is not consulted
    expect(embedUrlFor('https://vm.tiktok.com/ZMrRs9oPp/', 'https://evil.example/video/7290074173500706079')).toBeNull()
  })

  it('a canonical URL and a "cannot be framed" verdict each count as something learned', () => {
    expect(mergePreview({ provider: 'TikTok', media: 'video', canonical: 'https://www.tiktok.com/@_/video/7290074173500706079' }))
      .toEqual({ provider: 'TikTok', media: 'video', canonical: 'https://www.tiktok.com/@_/video/7290074173500706079' })
    expect(mergePreview({ provider: 'Instagram', media: 'video', embeddable: false })?.embeddable).toBe(false)
    expect(mergePreview({ provider: 'Instagram', media: 'video' })).toBeNull()
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
