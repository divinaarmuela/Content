/**
 * The link-preview route, end to end.
 *
 * Two layers. The first stubs `fetch` and replays what the real providers
 * answered on 2026-09-06 — Meta's 403, Instagram's embed page, TikTok's
 * redirect chain and oEmbed — so the route's ORDER of asking and what it
 * stores are pinned without a network. The second (`LIVE=1`) calls the real
 * providers with the owner's actual links and prints what came back; it is
 * how the "does this link work now" question gets a true answer, and it is
 * skipped in CI because a provider's mood is not a test failure.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

vi.mock('../app/lib/authz', () => ({
  requireRole: async () => ({ id: 'u1', name: 'Someone', role: 'scheduler', email: 'u1@x.invalid', active_status: true }),
  AuthzError: class AuthzError extends Error {
    status: number
    constructor(message: string, status: number) { super(message); this.status = status }
  },
  authzErrorResponse: (e: unknown) => ({
    error: e instanceof Error ? e.message : 'error',
    status: (e as { status?: number })?.status ?? 500,
  }),
}))

import { POST } from '../app/api/link-preview/route'

const call = async (url: string) => {
  const res = await POST(new Request('https://app.test/api/link-preview', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }),
  }))
  return { status: res.status, body: await res.json() as { preview: Record<string, unknown> | null; provider?: string | null; reason?: string } }
}

const BROKEN = readFileSync(join(__dirname, 'fixtures/instagram-embed-broken.html'), 'utf8')
const CAPTIONED = readFileSync(join(__dirname, 'fixtures/instagram-embed-captioned.html'), 'utf8')
const PIN_VIDEO = readFileSync(join(__dirname, 'fixtures/pinterest-pin-video.html'), 'utf8')
const PIN_IMAGE = readFileSync(join(__dirname, 'fixtures/pinterest-pin-image.html'), 'utf8')
const PIN_OEMBED = readFileSync(join(__dirname, 'fixtures/pinterest-oembed.json'), 'utf8')

const html = (body: string) => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const redirect = (to: string, status = 301) => new Response(null, { status, headers: { location: to } })

describe('link-preview route (replayed providers)', () => {
  const calls: string[] = []
  let answer: (url: string) => Response | Promise<Response>
  beforeEach(() => {
    calls.length = 0
    delete process.env.META_OEMBED_TOKEN
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      calls.push(url)
      return answer(url)
    }))
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('an Instagram post: no Meta call without a token, the embed page is read, and the og:image fills in the picture', async () => {
    answer = url => {
      if (url === 'https://www.instagram.com/p/Dbqg-OzRmcw/embed/captioned/') return html(BROKEN)
      if (url === 'https://www.instagram.com/p/Dbqg-OzRmcw/?igsh=abc') return html(
        '<html><head><meta property="og:image" content="https://scontent-mel1-1.cdninstagram.com/v/pic.jpg?x=1" />'
        + '<meta property="og:title" content="Blake Pope on Instagram: &quot;always standing on chairs&quot;" /></head></html>')
      throw new Error(`unexpected fetch ${url}`)
    }
    const { status, body } = await call('https://www.instagram.com/p/Dbqg-OzRmcw/?igsh=abc')
    expect(status).toBe(200)
    expect(calls.some(u => u.includes('graph.facebook.com'))).toBe(false)
    expect(calls[0]).toBe('https://www.instagram.com/p/Dbqg-OzRmcw/embed/captioned/')
    expect(body.preview).toEqual({
      provider: 'Instagram',
      media: 'video',
      // Instagram's own "may have been removed" page: the card must not
      // mount that frame as its face
      embeddable: false,
      thumb: 'https://scontent-mel1-1.cdninstagram.com/v/pic.jpg?x=1',
      title: 'Blake Pope on Instagram: "always standing on chairs"',
    })
  })

  it('an Instagram post whose embed page is served: picture and caption from the page itself, no second fetch', async () => {
    answer = url => {
      if (url.endsWith('/embed/captioned/')) return html(CAPTIONED)
      throw new Error(`unexpected fetch ${url}`)
    }
    const { body } = await call('https://www.instagram.com/reel/Da7nMMNS2PY/')
    expect(calls).toHaveLength(1)
    expect(body.preview?.thumb).toContain('cdninstagram.com')
    expect(body.preview?.title).toContain('Recent work for @henriettasclt')
    expect(body.preview?.embeddable).toBeUndefined()
  })

  it('an Instagram post nobody will tell us about is still not a failure', async () => {
    answer = () => html('<html><head><title>Instagram</title></head><body>splash</body></html>')
    const { status, body } = await call('https://www.instagram.com/p/Dbqg-OzRmcw/')
    expect(status).toBe(200)
    // the page's own <title> is "Instagram", which is not a caption — the
    // card keeps the provider and wears Instagram's frame
    expect(body.preview?.thumb).toBeUndefined()
    expect(body.preview?.embeddable).toBeUndefined()
  })

  it('asks Meta first when META_OEMBED_TOKEN is set', async () => {
    process.env.META_OEMBED_TOKEN = 'app|token'
    answer = url => {
      if (url.startsWith('https://graph.facebook.com/v25.0/instagram_oembed')) {
        return json({ thumbnail_url: 'https://scontent.cdninstagram.com/v/o.jpg', title: 'from oembed', author_name: 'a' })
      }
      throw new Error(`unexpected fetch ${url}`)
    }
    const { body } = await call('https://www.instagram.com/p/Dbqg-OzRmcw/')
    expect(calls[0]).toContain('access_token=app%7Ctoken')
    expect(calls).toHaveLength(1)
    expect(body.preview?.thumb).toBe('https://scontent.cdninstagram.com/v/o.jpg')
  })

  it('a vm.tiktok.com share link: followed to its id on TikTok hosts only, then oEmbed, then stored with a canonical URL', async () => {
    // the real chain, recorded 2026-09-06
    answer = url => {
      if (url === 'https://vm.tiktok.com/ZMrRs9oPp/') {
        return redirect('https://m.tiktok.com/v/7290074173500706079.html?_d=x&share_item_id=7290074173500706079')
      }
      if (url.startsWith('https://www.tiktok.com/oembed?')) {
        expect(decodeURIComponent(url)).toContain('url=https://www.tiktok.com/@_/video/7290074173500706079')
        return json({
          title: 'before sleep talk.....very cute couple....#cats #fyp ', author_name: 'Petsmeowwoof',
          author_url: 'https://www.tiktok.com/@petsmeowwoof', author_unique_id: 'petsmeowwoof',
          embed_product_id: '7290074173500706079', thumbnail_url: 'https://p16-common-sign.tiktokcdn.com/x.image',
          type: 'video',
        })
      }
      throw new Error(`unexpected fetch ${url}`)
    }
    const { body } = await call('https://vm.tiktok.com/ZMrRs9oPp/')
    expect(calls).toEqual(['https://vm.tiktok.com/ZMrRs9oPp/', expect.stringContaining('https://www.tiktok.com/oembed?')])
    expect(body.preview).toEqual({
      title: 'before sleep talk.....very cute couple....#cats #fyp',
      thumb: 'https://p16-common-sign.tiktokcdn.com/x.image',
      provider: 'TikTok',
      media: 'video',
      canonical: 'https://www.tiktok.com/@petsmeowwoof/video/7290074173500706079',
      // the account, so a mock-up made from this post can wear it
      author: '@petsmeowwoof',
    })
  })

  it('a share link whose redirect leaves TikTok is dropped there — no id, no canonical, and never the metadata service', async () => {
    answer = url => {
      if (url === 'https://vm.tiktok.com/ZMevil/') return redirect('https://169.254.169.254/latest/meta-data/')
      if (url === 'https://vm.tiktok.com/ZMaway/') return redirect('https://evil.example/video/7290074173500706079')
      if (url.startsWith('https://www.tiktok.com/oembed?')) return json({ message: 'Something went wrong', code: 400 }, 400)
      // the generic meta-tag fetch may still follow a public redirect, as it
      // does for any link; what it must never do is treat where it landed
      // as the video's home
      if (url.startsWith('https://evil.example/')) return html('<html><head><title>not tiktok</title></head></html>')
      throw new Error(`unexpected fetch ${url}`)
    }
    for (const u of ['https://vm.tiktok.com/ZMevil/', 'https://vm.tiktok.com/ZMaway/']) {
      calls.length = 0
      const { body } = await call(u)
      expect(calls.some(c => c.includes('169.254'))).toBe(false)
      expect(calls.some(c => c.includes('tiktok.com/oembed') && decodeURIComponent(c).includes('evil.example'))).toBe(false)
      expect(body.preview?.canonical).toBeUndefined()
    }
  })

  it('when oEmbed is down the id from the redirect still gives the card a canonical URL to play', async () => {
    answer = url => {
      if (url === 'https://vm.tiktok.com/ZMrRs9oPp/') return redirect('https://www.tiktok.com/@/video/7290074173500706079?_r=1')
      if (url.startsWith('https://www.tiktok.com/oembed?')) return new Response('', { status: 503 })
      if (url === 'https://vm.tiktok.com/ZMrRs9oPp/') return html('<html></html>')
      return html('<html><head><title>TikTok</title></head></html>')
    }
    const { body } = await call('https://vm.tiktok.com/ZMrRs9oPp/')
    expect(body.preview?.canonical).toBe('https://www.tiktok.com/@_/video/7290074173500706079')
    expect(body.preview?.provider).toBe('TikTok')
  })

  // ── Pinterest: the chain recorded 2026-09-06 ──
  const PIN = 'https://www.pinterest.com/pin/424605071145308382/'
  const MP4 = 'https://v1.pinimg.com/videos/iht/expMp4/73/7c/64/737c64f1ec9401ae9d71c55877e9a129_720w.mp4'
  /** what Pinterest's hosts answered: `www.` 302s to the country host for
   *  both the oEmbed and the page; the page is the fixture given */
  const pinterestAnswers = (page: string, oembed: Response = new Response(PIN_OEMBED, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } })) =>
    (url: string): Response => {
      if (url.startsWith('https://www.pinterest.com/oembed.json?')) return redirect(url.replace('https://www.', 'https://au.'), 302)
      if (url.startsWith('https://au.pinterest.com/oembed.json?')) return oembed
      if (url === PIN) return redirect('https://au.pinterest.com/pin/424605071145308382/', 302)
      if (url === 'https://au.pinterest.com/pin/424605071145308382/') return html(page)
      throw new Error(`unexpected fetch ${url}`)
    }

  it('a video pin: oEmbed then the page, each followed to the country host, and the card gets the mp4, the picture, the words and the pinner', async () => {
    answer = pinterestAnswers(PIN_VIDEO)
    const { status, body } = await call(PIN)
    expect(status).toBe(200)
    expect(calls).toEqual([
      expect.stringContaining('https://www.pinterest.com/oembed.json?format=json&url='),
      expect.stringContaining('https://au.pinterest.com/oembed.json?format=json&url='),
      PIN,
      'https://au.pinterest.com/pin/424605071145308382/',
    ])
    expect(body.preview).toMatchObject({
      provider: 'Pinterest',
      media: 'video',
      video: MP4,
      thumb: 'https://i.pinimg.com/736x/94/cc/c9/94ccc9ea5a579a414c731ca63c4dabfe.jpg',
      author: '@pinterest',
    })
    expect(String(body.preview?.title)).toMatch(/^🦕🧊 Dino-mite/)
    // the pasted link IS the pin's own URL, so there is nothing to resolve
    expect(body.preview?.canonical).toBeUndefined()
  })

  it('an image pin is a still with its picture and title, and no film', async () => {
    answer = pinterestAnswers(PIN_IMAGE)
    const { body } = await call(PIN)
    expect(body.preview).toMatchObject({ provider: 'Pinterest', media: 'image', title: 'Good idea in the school holidays', author: '@pinterest' })
    expect(body.preview?.video).toBeUndefined()
    expect(body.preview?.thumb).toContain('/736x/')
  })

  it('a pin on a country host is asked about by its id on www., and the card stores the pin\'s own URL', async () => {
    answer = pinterestAnswers(PIN_IMAGE)
    const { body } = await call('https://au.pinterest.com/pin/424605071145308382/?utm_source=share')
    expect(calls.every(c => !c.includes('utm_source'))).toBe(true)
    expect(body.preview?.canonical).toBe(PIN)
  })

  it('a pin.it share link: followed on Pinterest hosts only, the id read off the /sent/ hop, and never the page that hop bounces to', async () => {
    const base = pinterestAnswers(PIN_VIDEO)
    answer = url => {
      // the real chain, recorded 2026-09-06 (this pin id swapped for the fixture's)
      if (url === 'https://pin.it/39YYRhN0f') return redirect('https://api.pinterest.com/url_shortener/39YYRhN0f/redirect/', 308)
      if (url === 'https://api.pinterest.com/url_shortener/39YYRhN0f/redirect/') {
        return redirect('https://www.pinterest.com/pin/424605071145308382/sent/?invite_code=80139d28e8a34cb38c105de2e84ac671&sender=762164074346835038&sfo=1', 302)
      }
      return base(url)
    }
    const { body } = await call('https://pin.it/39YYRhN0f')
    expect(calls.some(c => c.includes('/sent/'))).toBe(false)
    expect(calls.slice(0, 2)).toEqual(['https://pin.it/39YYRhN0f', 'https://api.pinterest.com/url_shortener/39YYRhN0f/redirect/'])
    expect(body.preview).toMatchObject({ provider: 'Pinterest', media: 'video', video: MP4, canonical: PIN })
  })

  it('a share link whose chain leaves Pinterest is dropped there — no id, no canonical, and never the metadata service', async () => {
    answer = url => {
      if (url === 'https://pin.it/ZZevil') return redirect('https://169.254.169.254/latest/meta-data/', 308)
      if (url === 'https://pin.it/ZZaway') return redirect('https://evil.example/pin/424605071145308382/', 308)
      if (url.startsWith('https://evil.example/')) return html('<html><head><title>not pinterest</title></head></html>')
      throw new Error(`unexpected fetch ${url}`)
    }
    for (const u of ['https://pin.it/ZZevil', 'https://pin.it/ZZaway']) {
      calls.length = 0
      const { status, body } = await call(u)
      expect(status).toBe(200)
      expect(calls.some(c => c.includes('169.254'))).toBe(false)
      expect(calls.some(c => c.includes('pinterest.com/oembed'))).toBe(false)
      expect(body.preview?.canonical).toBeUndefined()
      expect(body.preview?.video).toBeUndefined()
    }
  })

  it('a pin Pinterest will not tell us about is not a failure: the card keeps the Pinterest mark and the link', async () => {
    answer = pinterestAnswers(
      '<html><head><title>Pinterest</title></head><body>nothing for a robot</body></html>',
      json({ error: 'Url was not found: ' + PIN }, 400),
    )
    const { status, body } = await call(PIN)
    expect(status).toBe(200)
    expect(body.preview).toBeNull()
    expect(body.provider).toBe('Pinterest')
    expect(body.reason).toBe('no_preview')
  })
})

// ── the real thing ──────────────────────────────────────────────────────────
// LIVE=1 npx vitest run tests/link-preview-route.test.ts
describe.runIf(process.env.LIVE === '1')('link-preview route (live providers)', () => {
  const LINKS = [
    'https://www.instagram.com/p/Dbqg-OzRmcw/',
    'https://www.instagram.com/p/Da7nMMNS2PY/',
    'https://vm.tiktok.com/ZMrRs9oPp/',
    'https://www.pinterest.com/pin/424605071145308382/',
    'https://www.pinterest.com/pin/424605071145374273/',
    'https://pin.it/39YYRhN0f',
  ]
  for (const link of LINKS) {
    it(`resolves ${link}`, async () => {
      const { status, body } = await call(link)
      const p = body.preview ?? {}
      console.log(`LIVE ${link} -> ${status} thumb=${p.thumb ? 'yes' : 'no'} caption=${p.title ? 'yes' : 'no'}`
        + ` embeddable=${p.embeddable === false ? 'NO (provider says broken)' : 'not known broken'}`
        + ` canonical=${p.canonical ?? '-'} title=${JSON.stringify(p.title ?? '')}`)
      expect(status).toBe(200)
    }, 30_000)
  }
})
