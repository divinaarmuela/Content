/**
 * What a pasted link actually IS — so a board card can show it.
 *
 * A link card used to be a chip: an icon, a title, a hostname. On a moodboard
 * that is the least useful thing a reference can be, because the whole point of
 * dropping a competitor's Reel onto the board is to look at it. The card should
 * show the Reel.
 *
 * Everything here is pure. Some of it needs no network at all — a YouTube
 * thumbnail is derivable from the URL, which means the commonest case resolves
 * instantly and still works when the fetch is blocked. The rest is parsing:
 * given whatever the page or an oEmbed endpoint returned, produce the same
 * small shape.
 *
 * The safety half matters as much as the parsing half. Fetching a URL a user
 * typed, from our server, is a request made with our network position — so the
 * guard here is not politeness, it is the thing standing between a text field
 * and the metadata endpoint of the host we run on.
 */

/** The shape a card stores. Every field optional: a link we learned nothing
 *  about still renders, as the chip it always was. */
export type LinkPreview = {
  /** the page's own title, or the post's caption */
  title?: string
  /** an https image URL to draw as the card's face */
  thumb?: string
  /** "YouTube", "TikTok" — shown as a chip, never guessed from the title */
  provider?: string
  /** what it is, which decides whether the card wears a play badge */
  media?: 'video' | 'image' | 'page'
  /** the provider's own URL for the same post, when the pasted one was a
   *  short link with no id in it — a `vm.tiktok.com` share link resolves to
   *  `tiktok.com/@user/video/<id>`, and only the latter can be a frame */
  canonical?: string
  /** false when the provider itself told us this post cannot be framed —
   *  Instagram's embed page answering "this post may have been removed".
   *  Never true: absent means "not known to be broken", which is the default
   *  and needs no field. */
  embeddable?: false
  /** the account the post belongs to — "@handle" where the provider says
   *  one, else the display name — so a mock-up can wear the real account */
  author?: string
  /** a plain https mp4 of the post itself, on the provider's own CDN, when
   *  the provider exposes one (Pinterest does, for a video pin) — the card
   *  plays it the way it plays our own files: silent, looping, in place.
   *  Absent for a post that is only HLS, or a frame, or a picture. */
  video?: string
}

export type Provider = {
  name: string
  /** hostnames, matched on the registrable tail so www. and m. both hit */
  hosts: string[]
  /** the provider's oEmbed endpoint — public for most; Meta's needs a token */
  oembed?: string
  /** what this provider's links generally are */
  media: LinkPreview['media']
}

/** Pinned: an unversioned Graph call is a call to whatever ships next. */
const GRAPH = 'https://graph.facebook.com/v25.0'

export const PROVIDERS: Provider[] = [
  { name: 'YouTube', hosts: ['youtube.com', 'youtu.be'], oembed: 'https://www.youtube.com/oembed', media: 'video' },
  { name: 'TikTok', hosts: ['tiktok.com'], oembed: 'https://www.tiktok.com/oembed', media: 'video' },
  { name: 'Vimeo', hosts: ['vimeo.com'], oembed: 'https://vimeo.com/api/oembed.json', media: 'video' },
  // Meta's oEmbed NEEDS a token. Verified 2026-09-06: with no access_token
  // the Graph endpoint answers 403 `(#200) Provide valid app ID`. (An earlier
  // version of this comment claimed it had opened up in June 2026 — it had
  // not.) The token is `META_OEMBED_TOKEN`, an `app_id|client_token` pair
  // from a Meta app with the oEmbed Read feature; the agency has no such app
  // today, so `oembedUrlFor` returns null for Meta without one and the route
  // reads the PUBLIC embed page instead (`instagramEmbedPageUrl` +
  // `fromInstagramEmbedHtml`), which needs no app at all.
  { name: 'Instagram', hosts: ['instagram.com'], oembed: `${GRAPH}/instagram_oembed`, media: 'video' },
  { name: 'Threads', hosts: ['threads.net', 'threads.com'], oembed: `${GRAPH}/threads_oembed`, media: 'page' },
  // Facebook splits posts and videos across two endpoints and guessing wrong
  // 400s, so it keeps the Open Graph path, which it does serve.
  { name: 'Facebook', hosts: ['facebook.com', 'fb.watch'], media: 'video' },
  { name: 'X', hosts: ['twitter.com', 'x.com'], media: 'page' },
  { name: 'LinkedIn', hosts: ['linkedin.com'], media: 'page' },
  // Pinterest's oEmbed answers with no key (verified 2026-09-06): the pin's
  // words, the pinner, and a 236px thumbnail. `www.` 302s to the viewer's
  // country host (`au.pinterest.com` from here) — followed, on Pinterest's
  // hosts only. Whether a pin is a VIDEO, and its mp4, the pin page alone
  // says (`fromPinterestPageHtml`).
  { name: 'Pinterest', hosts: ['pinterest.com', 'pin.it'], oembed: 'https://www.pinterest.com/oembed.json', media: 'image' },
]

function hostOf(url: string): string | null {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, '') } catch { return null }
}

/** Which provider a URL belongs to, matched on the registrable tail so
 *  `m.youtube.com` and `vm.tiktok.com` are recognised too. */
export function providerFor(url: string): Provider | null {
  const host = hostOf(url)
  if (!host) return null
  return PROVIDERS.find(p => p.hosts.some(h => host === h || host.endsWith(`.${h}`))) ?? null
}

/**
 * Never fetch this URL from our server.
 *
 * https only — an http fetch is both a downgrade and a redirect vector. Then
 * the hosts that are not "somewhere on the internet" but "somewhere inside
 * our own network": loopback, link-local (which on a cloud host is the
 * instance metadata service), and the RFC1918 ranges. A hostname with no dot
 * is an internal name by definition.
 *
 * This runs again on every redirect hop, because the first URL being safe says
 * nothing about where it points.
 */
export function isSafePreviewUrl(url: string): boolean {
  let u: URL
  try { u = new URL(url) } catch { return false }
  if (u.protocol !== 'https:') return false
  const host = u.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) return false
  if (!host.includes('.')) return false
  // bracketed IPv6, including the ::1 loopback and unique-local fc00::/7
  if (host.startsWith('[')) return false
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    if (a === 127 || a === 10 || a === 0) return false
    if (a === 169 && b === 254) return false          // link-local / metadata
    if (a === 172 && b >= 16 && b <= 31) return false
    if (a === 192 && b === 168) return false
    if (a >= 224) return false                        // multicast and above
  }
  return true
}

/** YouTube's video id, from any of the shapes it hands out. */
export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url)
    const host = u.hostname.toLowerCase().replace(/^www\./, '')
    if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null
    if (!host.endsWith('youtube.com')) return null
    const v = u.searchParams.get('v')
    if (v) return v
    // /shorts/<id>, /embed/<id>, /live/<id>
    const m = /^\/(?:shorts|embed|live|v)\/([^/?#]+)/.exec(u.pathname)
    return m?.[1] ?? null
  } catch { return null }
}

/**
 * The preview we can build from the URL alone, with no request at all.
 *
 * Worth having for its own sake: it is instant, it cannot fail, and it keeps
 * working when the provider blocks us — which for a Shorts link is most of the
 * value of this whole file.
 */
export function offlinePreview(url: string): LinkPreview | null {
  const id = youtubeId(url)
  if (id && /^[\w-]{6,20}$/.test(id)) {
    return {
      provider: 'YouTube',
      media: 'video',
      thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    }
  }
  return null
}

/** The oEmbed URL to ask, or null when there is no point asking.
 *
 *  `token` is Meta's app token (`META_OEMBED_TOKEN`). Meta's endpoints refuse
 *  every call without one, so for Instagram and Threads a missing token
 *  means no URL — not a 403 we then wait on. Passed in rather than read from
 *  the environment so this stays pure. */
export function oembedUrlFor(url: string, token?: string | null): string | null {
  const provider = providerFor(url)
  if (!provider?.oembed) return null
  const meta = provider.oembed.startsWith(GRAPH)
  if (meta && !token) return null
  return `${provider.oembed}?format=json&url=${encodeURIComponent(url)}`
    + (meta && token ? `&access_token=${encodeURIComponent(token)}` : '')
    // Meta returns a whole embed <blockquote> unless told not to; we want the
    // fields, not a script tag we are never going to render
    + (meta ? '&omitscript=true' : '')
}

/** The named entities a page's head uses, plus the numeric ones Instagram
 *  writes its captions in (`&#x1f92a;` is an emoji, `&#064;` is an @) —
 *  `&amp;` last, so `&amp;lt;` stays the text it was. */
const decodeEntities = (s: string) => s
  .replace(/&#x([0-9a-f]{1,6});/gi, (_, h: string) => safeChar(parseInt(h, 16)))
  .replace(/&#(\d{1,7});/g, (_, d: string) => safeChar(Number(d)))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')

const safeChar = (code: number) =>
  Number.isFinite(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
    ? String.fromCodePoint(code) : ''

/**
 * Open Graph and Twitter card tags out of a page's head.
 *
 * Deliberately a regex and not a parser: we want four strings out of the first
 * few KB of a document that is often malformed, and pulling a DOM library into
 * the server for that is the wrong trade.
 */
export function parseMetaTags(html: string): Record<string, string> {
  const out: Record<string, string> = {}
  const tag = /<meta\s+[^>]*>/gi
  let m: RegExpExecArray | null
  while ((m = tag.exec(html)) !== null) {
    const el = m[0]
    const key = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(el)?.[1]?.toLowerCase()
    const value = /content\s*=\s*["']([^"']*)["']/i.exec(el)?.[1]
    if (key && value && !(key in out)) out[key] = decodeEntities(value).trim()
  }
  const title = /<title[^>]*>([^<]{1,300})<\/title>/i.exec(html)?.[1]
  if (title && !out['og:title']) out['og:title'] = decodeEntities(title).trim()
  return out
}

/** oEmbed's own answer, which is friendlier than scraping when it exists. */
export function fromOembed(json: unknown, url: string): LinkPreview {
  const j = (json ?? {}) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
  const provider = providerFor(url)
  const thumb = str(j.thumbnail_url)
  const author = str(j.author_name)
  const title = str(j.title)
  // TikTok's answer names the video by its numeric id and its author, which
  // is everything a frame needs — and everything a vm.tiktok.com share link
  // lacks. Recorded as the canonical URL so the card can play even though
  // the link that was pasted could not.
  const id = str(j.embed_product_id)
  // Pinterest names the pinner by profile URL (`pinterest.com/<username>/`),
  // which is the handle the way TikTok's `@user` is
  const handle = str(j.author_unique_id) ?? /\/@([\w.-]+)/.exec(str(j.author_url) ?? '')?.[1]
    ?? (provider?.name === 'Pinterest' ? pinterestUsername(str(j.author_url) ?? '') : undefined)
  const canonical = provider?.name === 'TikTok' && id && TIKTOK_ID.test(id)
    ? tiktokCanonicalUrl(id, handle) : undefined
  const who = handle ? `@${handle}` : author
  // Pinterest's oEmbed thumbnail is 236px wide — a tile, not a card's face
  const face = thumb && provider?.name === 'Pinterest' ? pinterestLargerImage(thumb) : thumb
  return {
    ...(title || author ? { title: (title ?? author)!.slice(0, 200) } : {}),
    ...(face && isSafePreviewUrl(face) ? { thumb: face.slice(0, 2000) } : {}),
    ...(provider ? { provider: provider.name } : {}),
    ...(who ? { author: who.slice(0, 80) } : {}),
    ...(canonical && canonical !== url ? { canonical } : {}),
    media: str(j.type) === 'photo' ? 'image' : provider?.media ?? 'page',
  }
}

/* ────────────────────────────── Instagram ────────────────────────────── */

/** An Instagram post's shortcode, from any of the link shapes people paste:
 *  `/p/`, `/reel/`, `/reels/`, `/tv/`, with or without the trailing slash,
 *  and whatever `?igsh=…` or `?utm_…` the share sheet stapled on. */
export function instagramShortcode(url: string): string | null {
  let u: URL
  try { u = new URL(url) } catch { return null }
  const host = u.hostname.toLowerCase().replace(/^www\./, '')
  if (host !== 'instagram.com' && !host.endsWith('.instagram.com')) return null
  const m = /^\/(?:p|reel|reels|tv)\/([\w-]{5,40})(?:\/|$)/.exec(u.pathname)
  return m?.[1] ?? null
}

/**
 * The public embed page for a post — the one thing Instagram serves to a
 * server without an app, a token or a login. Built from the shortcode alone,
 * so nothing from the pasted URL (its query, its path) reaches the request.
 * The captioned variant, because that is the one that carries the caption.
 */
export function instagramEmbedPageUrl(url: string): string | null {
  const code = instagramShortcode(url)
  return code ? `https://www.instagram.com/p/${code}/embed/captioned/` : null
}

/** Only Instagram's and Facebook's own CDNs may be a card's face: the embed
 *  page is HTML we did not write, and an `<img src>` in it that pointed
 *  anywhere else would be a picture of someone else's choosing. */
export function isInstagramCdnUrl(url: string): boolean {
  let u: URL
  try { u = new URL(url) } catch { return false }
  if (u.protocol !== 'https:') return false
  const host = u.hostname.toLowerCase()
  return ['cdninstagram.com', 'fbcdn.net'].some(h => host === h || host.endsWith(`.${h}`))
}

/** The words of a fragment of HTML, entities decoded and whitespace folded. */
const textOf = (html: string) =>
  decodeEntities(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()

/**
 * What the embed page says about the post.
 *
 * Three shapes, checked in order:
 *  1. `<div class="EmbedBrokenMedia">` — Instagram's own "this post may have
 *     been removed". The post cannot be framed; say so (`embeddable: false`)
 *     so the card never mounts a frame that would show that message.
 *  2. `<img class="EmbeddedMediaImage" src="…">` for the picture, and the
 *     `.Caption` block for the words (minus the username link and the
 *     "View all N comments" tail Instagram appends).
 *  3. A `window.__additionalDataLoaded(…, {…})` JSON blob, older pages —
 *     `display_url` and the caption's `text` live inside it.
 *
 * Regexes on purpose, like `parseMetaTags`: three strings out of a page we
 * do not control, with no DOM library on the server for it.
 */
export function fromInstagramEmbedHtml(html: string): LinkPreview | null {
  if (/class="[^"]*\bEmbedBrokenMedia\b/.test(html)) {
    return { provider: 'Instagram', media: 'video', embeddable: false }
  }
  let thumb: string | undefined
  let title: string | undefined

  const img = /<img\s+[^>]*class="[^"]*\bEmbeddedMediaImage\b[^"]*"[^>]*>/i.exec(html)?.[0]
    ?? /<img\s+[^>]*src="[^"]*cdninstagram\.com[^"]*"[^>]*>/i.exec(html)?.[0]
  const src = img ? /\bsrc\s*=\s*"([^"]+)"/i.exec(img)?.[1] : undefined
  if (src) {
    const decoded = decodeEntities(src)
    if (isInstagramCdnUrl(decoded)) thumb = decoded.slice(0, 2000)
  }

  const cap = /<div\s+class="Caption"[^>]*>([\s\S]*?)(?:<div\s+class="CaptionComments"|<\/div>)/i.exec(html)?.[1]
  let author: string | undefined
  if (cap) {
    const words = textOf(cap.replace(/<a\s+class="CaptionUsername"[^>]*>[\s\S]*?<\/a>/i, ''))
    if (words) title = words.slice(0, 200)
    const who = textOf(/<a\s+class="CaptionUsername"[^>]*>([\s\S]*?)<\/a>/i.exec(cap)?.[1] ?? '')
    if (who && /^[\w.]{1,60}$/.test(who)) author = `@${who}`
  }

  if (!thumb || !title) {
    const blob = /__additionalDataLoaded\s*\([^,]+,\s*(\{[\s\S]*?\})\s*\)\s*;?\s*<\/script>/.exec(html)?.[1]
    if (blob) {
      try {
        const data = JSON.parse(blob) as Record<string, unknown>
        const media = (data.shortcode_media
          ?? (data.graphql as Record<string, unknown> | undefined)?.shortcode_media) as Record<string, unknown> | undefined
        const display = typeof media?.display_url === 'string' ? media.display_url : undefined
        if (!thumb && display && isInstagramCdnUrl(display)) thumb = display.slice(0, 2000)
        const edges = (media?.edge_media_to_caption as { edges?: { node?: { text?: unknown } }[] } | undefined)?.edges
        const text = edges?.[0]?.node?.text
        if (!title && typeof text === 'string' && text.trim()) title = text.trim().slice(0, 200)
      } catch { /* not the blob we know; the page's markup already had its say */ }
    }
  }

  if (!thumb && !title) return null
  // the served page says what the post is in `data-media-type="GraphVideo"`
  // (or GraphImage / GraphSidecar for a carousel); the older blob in `is_video`
  const isVideo = /data-media-type="GraphVideo"|"is_video":\s*true|\bEmbeddedMediaVideo\b|class="[^"]*\bVideoPlayButton\b/.test(html)
  return {
    ...(title ? { title } : {}),
    ...(thumb ? { thumb } : {}),
    ...(author ? { author } : {}),
    provider: 'Instagram',
    media: isVideo ? 'video' : 'image',
  }
}

/* ─────────────────────────────── TikTok ─────────────────────────────── */

/** real ids are 19 digits; the floor is loose because it costs nothing —
 *  the id only ever becomes a path segment on TikTok's own host */
const TIKTOK_ID = /^\d{5,25}$/

/** The canonical page for a TikTok video. TikTok routes on the id alone —
 *  its own redirects land on `/@/video/<id>` — so an unknown author is
 *  spelled `_` rather than guessed. */
export function tiktokCanonicalUrl(id: string, handle?: string | null): string {
  const h = handle && /^[\w.-]{1,60}$/.test(handle) ? handle : '_'
  return `https://www.tiktok.com/@${h}/video/${id}`
}

/** TikTok's numeric video id, from any URL of theirs that carries one:
 *  `/@user/video/<id>`, the mobile `/v/<id>.html`, the player `/player/v1/<id>`,
 *  or the `share_item_id` their redirects append. Null for a share short link
 *  (`vm.`/`vt.tiktok.com/<code>`), which has no id until it is followed. */
export function tiktokVideoId(url: string): string | null {
  let u: URL
  try { u = new URL(url) } catch { return null }
  const host = u.hostname.toLowerCase().replace(/^www\./, '')
  if (host !== 'tiktok.com' && !host.endsWith('.tiktok.com')) return null
  const m = /\/(?:video|v|player\/v1)\/(\d{5,25})(?:\.html)?(?:\/|$)/.exec(u.pathname)
  if (m) return m[1]
  const share = u.searchParams.get('share_item_id')
  return share && TIKTOK_ID.test(share) ? share : null
}

/** A TikTok link that names the video only by a share code — the shape the
 *  app's Share → Copy link hands out — so the id must be found by following it. */
export function isTikTokShortLink(url: string): boolean {
  let u: URL
  try { u = new URL(url) } catch { return false }
  const host = u.hostname.toLowerCase().replace(/^www\./, '')
  if (host === 'vm.tiktok.com' || host === 'vt.tiktok.com') return true
  return host === 'tiktok.com' && /^\/t\/[\w-]+\/?$/.test(u.pathname)
}

/** A redirect hop we are willing to follow for a TikTok short link: their
 *  own hosts, and nothing else. On top of the SSRF guard, not instead of it. */
export function isTikTokHost(url: string): boolean {
  let u: URL
  try { u = new URL(url) } catch { return false }
  const host = u.hostname.toLowerCase()
  return host === 'tiktok.com' || host.endsWith('.tiktok.com')
}

/* ────────────────────────────── Pinterest ───────────────────────────── */

/**
 * What Pinterest actually serves — every line below observed 2026-09-06
 * from this network with real requests, a browser UA and a bot UA alike:
 *
 *  - `pinterest.com/pin/<id>/` 308s to `www.`; `www.` 302s to the viewer's
 *    country host (`au.pinterest.com` from here). The page is ~1.2 MB and
 *    its `<meta property="og:…">` tags are INJECTED PAST THE 1 MB MARK, not
 *    in the head — a reader that stops at a few KB sees none of them. An
 *    image pin carries `og:image` (a 736px `i.pinimg.com` picture),
 *    `og:title` and `og:description`; a video pin carries `og:image` only —
 *    no `og:title`, no `og:video`. The pin's words, the pinner and the
 *    video files live in a relay payload:
 *    `window.__PWS_RELAY_REGISTER_COMPLETED_REQUEST__("<query>", {json})`,
 *    whose `data.v3GetPinQueryv2.data` is the Pin (`__typename: "Pin"`):
 *    `description`, `title`, `pinner.username`, and for a video
 *    `videos.videoList.v720P.url` — a plain H.264 mp4 on `v1.pinimg.com`
 *    (`…/expMp4/…_720w.mp4`) beside the HLS `vHLSV4` m3u8 and the HEVC
 *    `hevcMp4V3` renditions a browser cannot be relied on to play.
 *  - `pin.it/<code>` 308s to `api.pinterest.com/url_shortener/<code>/redirect/`,
 *    which 302s to `www.pinterest.com/pin/<id>/sent/?invite_code=…` — and
 *    THAT page bounces to `/?show_error=true`, so the id is read off the
 *    chain as it goes by, never off the page it lands on. A code Pinterest
 *    does not know 302s to the home page: no id, no preview, no error.
 *  - `www.pinterest.com/oembed.json?url=<pin>` 302s to the country host and
 *    answers `{title, author_name, author_url, thumbnail_url (236px)}` with
 *    no key. For a pin that is gone or private: 400 `"Url was not found"`.
 *  - `/resource/PinResource/get/` — the JSON the page itself calls — is 403
 *    to a server. Not an option.
 */

/** a pin id is a run of digits; loose floor, same reasoning as TikTok's */
const PIN_ID = /^\d{5,25}$/

const pinterestHostOf = (url: string): string | null => {
  let u: URL
  try { u = new URL(url) } catch { return null }
  return u.protocol === 'https:' ? u.hostname.toLowerCase() : null
}

/** A redirect hop we are willing to follow for a Pinterest link: the hosts
 *  their chain actually passes through (`pin.it`, `api.pinterest.com`,
 *  `www.` and the country hosts), and nothing else. On top of the SSRF
 *  guard, not instead of it. */
export function isPinterestHost(url: string): boolean {
  const host = pinterestHostOf(url)
  if (!host) return false
  return host === 'pin.it' || host === 'pinterest.com' || host.endsWith('.pinterest.com')
}

/** A `pin.it/<code>` share link — the shape the app's Share → Copy link
 *  hands out — which names the pin by a code until it is followed. */
export function isPinterestShortLink(url: string): boolean {
  let u: URL
  try { u = new URL(url) } catch { return false }
  return u.hostname.toLowerCase() === 'pin.it' && /^\/[\w-]{3,40}\/?$/.test(u.pathname)
}

/** The pin's id from any Pinterest URL that carries one: `/pin/<id>/`, the
 *  slugged `/pin/some-words--<id>/` the og:url uses, and the `/pin/<id>/sent/`
 *  the short-link chain passes through. Null for a `pin.it` code. */
export function pinterestPinId(url: string): string | null {
  const host = pinterestHostOf(url)
  if (!host || !(host === 'pinterest.com' || host.endsWith('.pinterest.com'))) return null
  let path = ''
  try { path = new URL(url).pathname } catch { return null }
  const m = /^\/pin\/(?:[^/]*?--)?(\d{5,25})(?:\/|$)/.exec(path)
  return m && PIN_ID.test(m[1]) ? m[1] : null
}

/** The one page for a pin, built from the id alone so nothing from the
 *  pasted URL (a country host, a slug, a `?invite_code=`) reaches the
 *  request — and the URL a short link is stored as, so the card is the
 *  pin, not the code. */
export function pinterestCanonicalUrl(id: string): string {
  return `https://www.pinterest.com/pin/${id}/`
}

/** Only Pinterest's own CDN may be a card's face or its film: the page is
 *  HTML we did not write, and a URL in it that pointed anywhere else would
 *  be media of someone else's choosing. */
export function isPinterestCdnUrl(url: string): boolean {
  const host = pinterestHostOf(url)
  return Boolean(host && (host === 'pinimg.com' || host.endsWith('.pinimg.com')))
}

/** The 736px rendition of a `i.pinimg.com` picture the oEmbed hands out at
 *  236px. Every pin has one — it is the size the page's own `og:image`
 *  points at — and the path is the same but for the size segment. */
export function pinterestLargerImage(url: string): string {
  return isPinterestCdnUrl(url) ? url.replace(/\/236x\//, '/736x/') : url
}

/** The username out of a pinner's profile URL, `pinterest.com/<username>/`. */
export function pinterestUsername(profileUrl: string): string | undefined {
  const host = pinterestHostOf(profileUrl)
  if (!host || !(host === 'pinterest.com' || host.endsWith('.pinterest.com'))) return undefined
  let path = ''
  try { path = new URL(profileUrl).pathname } catch { return undefined }
  const m = /^\/([\w.-]{1,60})\/?$/.exec(path)
  return m && m[1] !== 'pin' ? m[1] : undefined
}

/** The mp4 a browser will play, out of the renditions Pinterest lists:
 *  H.264 (`expMp4`) over HEVC, and the widest of those. Null when the pin
 *  is HLS only. */
function pickPinterestMp4(urls: string[]): string | null {
  const mp4s = urls.filter(u => /\.mp4(\?|#|$)/i.test(u) && isPinterestCdnUrl(u) && !/hevc|h265/i.test(u))
  if (!mp4s.length) return null
  const width = (u: string) => Number(/_(\d+)w\.mp4/i.exec(u)?.[1] ?? 0)
  return mp4s.sort((a, b) => width(b) - width(a))[0]
}

/** The Pin object out of a relay payload — walked for the one thing that
 *  says it is a Pin, since the path around it is Pinterest's to change. */
function findPinObject(node: unknown, depth = 0): Record<string, unknown> | null {
  if (!node || typeof node !== 'object' || depth > 12) return null
  if (Array.isArray(node)) {
    for (const v of node) { const hit = findPinObject(v, depth + 1); if (hit) return hit }
    return null
  }
  const o = node as Record<string, unknown>
  if (o.__typename === 'Pin' && typeof o.entityId === 'string') return o
  for (const v of Object.values(o)) { const hit = findPinObject(v, depth + 1); if (hit) return hit }
  return null
}

/**
 * What the pin page says about the pin.
 *
 * Two sources, merged, best first:
 *  1. The relay payload(s): the pin's own words (`title`, else
 *     `description`), the pinner's username, the mp4 and the poster.
 *  2. The injected meta tags: `og:image` (736px) and, on an image pin,
 *     `og:title` / `og:description`.
 *
 * Regexes and JSON.parse on the payload, no DOM library — same trade as
 * `parseMetaTags`. A page with neither yields null: the card keeps the
 * Pinterest mark and the link's label, never a broken picture.
 */
export function fromPinterestPageHtml(html: string): LinkPreview | null {
  let title: string | undefined
  let author: string | undefined
  let thumb: string | undefined
  let video: string | undefined
  let hls = false

  const relay = /__PWS_RELAY_REGISTER_COMPLETED_REQUEST__\(\s*"(?:[^"\\]|\\.)*"\s*,\s*/g
  let m: RegExpExecArray | null
  while ((m = relay.exec(html)) !== null) {
    const start = m.index + m[0].length
    const end = html.indexOf('</script>', start)
    if (end < 0) break
    const body = html.slice(start, end).trim().replace(/\)\s*;?\s*$/, '')
    let pin: Record<string, unknown> | null = null
    try { pin = findPinObject(JSON.parse(body)) } catch { continue }
    if (!pin) continue
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
    if (!title) title = str(pin.title) ?? str(pin.description) ?? str(pin.gridTitle)
    const pinner = pin.pinner as Record<string, unknown> | undefined
    const username = str(pinner?.username)
    if (!author && username && /^[\w.-]{1,60}$/.test(username)) author = `@${username}`
    const videos = pin.videos as Record<string, unknown> | null | undefined
    if (videos) {
      const urls: string[] = []
      const list = videos.videoList as Record<string, { url?: unknown; thumbnail?: unknown }> | undefined
      if (list) {
        for (const r of Object.values(list)) {
          if (typeof r?.url === 'string') urls.push(r.url)
          if (!thumb && typeof r?.thumbnail === 'string' && isPinterestCdnUrl(r.thumbnail)) thumb = r.thumbnail
        }
      }
      if (Array.isArray(videos.videoUrls)) for (const u of videos.videoUrls) if (typeof u === 'string') urls.push(u)
      if (urls.some(u => /\.m3u8(\?|#|$)/i.test(u))) hls = true
      if (!video) video = pickPinterestMp4(urls) ?? undefined
    }
    const large = str(pin.imageLargeUrl)
    if (!thumb && large && isPinterestCdnUrl(large)) thumb = large
  }

  const tags = parseMetaTags(html)
  const og = tags['og:image'] ?? tags['twitter:image:src']
  // the page's own picture beats a video's poster frame as the face
  if (og && isPinterestCdnUrl(og)) thumb = og
  if (!title) title = tags['og:title'] ?? tags['og:description'] ?? tags['description']
  // the site's own name (the <title> of a page that told a robot nothing)
  // is not a caption
  if (title && /^pinterest$/i.test(title)) title = undefined

  if (!thumb && !title && !video) return null
  return {
    ...(title ? { title: title.slice(0, 200) } : {}),
    ...(thumb ? { thumb: thumb.slice(0, 2000) } : {}),
    ...(author ? { author } : {}),
    ...(video ? { video: video.slice(0, 2000) } : {}),
    provider: 'Pinterest',
    media: video || hls ? 'video' : 'image',
  }
}

/** …and the same shape from a page's meta tags. */
export function fromMetaTags(tags: Record<string, string>, url: string): LinkPreview {
  const provider = providerFor(url)
  const thumb = tags['og:image'] ?? tags['og:image:secure_url'] ?? tags['twitter:image']
  const title = tags['og:title'] ?? tags['twitter:title']
  const site = tags['og:site_name']
  const isVideo = Boolean(tags['og:video'] ?? tags['og:video:url']) || tags['og:type'] === 'video'
  return {
    ...(title ? { title: title.slice(0, 200) } : {}),
    ...(thumb && isSafePreviewUrl(thumb) ? { thumb: thumb.slice(0, 2000) } : {}),
    ...(provider?.name || site ? { provider: (provider?.name ?? site)!.slice(0, 40) } : {}),
    media: isVideo ? 'video' : provider?.media ?? (thumb ? 'image' : 'page'),
  }
}

/**
 * Merge what we learned, best source first, and drop a preview that says
 * nothing.
 *
 * A card with a provider chip and no picture is not a preview — it is the chip
 * we already had, wearing a new field. Only a thumbnail or a title earns one.
 */
export function mergePreview(...parts: (LinkPreview | null | undefined)[]): LinkPreview | null {
  const out: LinkPreview = {}
  for (const p of parts) {
    if (!p) continue
    if (!out.thumb && p.thumb) out.thumb = p.thumb
    if (!out.title && p.title) out.title = p.title
    if (!out.provider && p.provider) out.provider = p.provider
    if ((!out.media || out.media === 'page') && p.media) out.media = p.media
    if (!out.canonical && p.canonical) out.canonical = p.canonical
    if (!out.author && p.author) out.author = p.author
    if (!out.video && p.video) out.video = p.video
    if (p.embeddable === false) out.embeddable = false
  }
  // a playable file makes the post a video whatever an earlier source said
  if (out.video) out.media = 'video'
  // a canonical URL is what lets a short link play, a film is what plays,
  // and "cannot be framed" is what stops a card mounting a frame that says
  // so — each is worth storing
  return out.thumb || out.title || out.video || out.canonical || out.embeddable === false ? out : null
}

/**
 * A URL that will play inside an iframe, or null.
 *
 * Built ourselves from the video id rather than taken from oEmbed's `html`,
 * because that field is a blob of markup with a script tag in it and injecting
 * a provider's markup into our page is a bigger decision than playing a video.
 * A URL we construct is inert until it is put in a frame.
 *
 * `canonical` is the provider's own URL for the same post when the pasted one
 * was a short link with no id in it (see `LinkPreview.canonical`); it is
 * consulted only when the pasted URL yields nothing.
 */
export function embedUrlFor(url: string, canonical?: string | null): string | null {
  const yt = youtubeId(url)
  if (yt && /^[\w-]{6,20}$/.test(yt)) {
    // no related videos at the end, no cookie-heavy host
    return `https://www.youtube-nocookie.com/embed/${yt}?autoplay=1&rel=0`
  }
  let u: URL
  try { u = new URL(url) } catch { return null }
  const host = u.hostname.toLowerCase().replace(/^www\./, '')
  const path = u.pathname

  if (host.endsWith('vimeo.com')) {
    const id = /^\/(\d+)/.exec(path)?.[1]
    return id ? `https://player.vimeo.com/video/${id}?autoplay=1` : null
  }

  // Instagram publishes an embed page per post, and it renders in a plain
  // iframe with no script of theirs on our page. `/p/`, `/reel/` and `/tv/`
  // all have one, and the shortcode is the only part that matters.
  if (host.endsWith('instagram.com')) {
    const m = /^\/(?:p|reel|reels|tv)\/([\w-]+)/.exec(path)
    return m ? `https://www.instagram.com/p/${m[1]}/embed/captioned/` : null
  }

  // TikTok's is keyed on the numeric video id. A vm.tiktok.com short link
  // has no id until it is followed — the link-preview route follows it and
  // stores the answer as `canonical`, which is consulted here.
  if (host.endsWith('tiktok.com')) {
    const id = tiktokVideoId(url) ?? (canonical ? tiktokVideoId(canonical) : null)
    return id ? `https://www.tiktok.com/embed/v2/${id}` : null
  }

  // Facebook's plugin takes the post URL whole rather than an id
  if (host.endsWith('facebook.com') || host.endsWith('fb.watch')) {
    return `https://www.facebook.com/plugins/post.php?href=${encodeURIComponent(url)}&show_text=true`
  }

  return null
}

/** Does this URL point at a video file we host ourselves? */
export function isPlayableFile(url: string): boolean {
  return /\.(mp4|mov|m4v|webm)(\?|#|$)/i.test(url)
}

/** The hostname a card shows when there is nothing better to say. */
export function displayHost(url: string): string {
  return hostOf(url) ?? url.slice(0, 40)
}
