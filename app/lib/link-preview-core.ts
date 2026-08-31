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
}

export type Provider = {
  name: string
  /** hostnames, matched on the registrable tail so www. and m. both hit */
  hosts: string[]
  /** a public oEmbed endpoint that needs no key, when the provider has one */
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
  // Meta's oEmbed went behind an app token and App Review in 2020, which is
  // why this file was first written assuming Instagram could never resolve.
  // That was reversed on 15 June 2026: the Graph oEmbed endpoints answer for
  // PUBLIC posts with no token and no review. A token still works and raises
  // the rate limit, so `META_OEMBED_TOKEN` is used when it is set and simply
  // left out when it is not.
  { name: 'Instagram', hosts: ['instagram.com'], oembed: `${GRAPH}/instagram_oembed`, media: 'video' },
  { name: 'Threads', hosts: ['threads.net', 'threads.com'], oembed: `${GRAPH}/threads_oembed`, media: 'page' },
  // Facebook splits posts and videos across two endpoints and guessing wrong
  // 400s, so it keeps the Open Graph path, which it does serve.
  { name: 'Facebook', hosts: ['facebook.com', 'fb.watch'], media: 'video' },
  { name: 'X', hosts: ['twitter.com', 'x.com'], media: 'page' },
  { name: 'LinkedIn', hosts: ['linkedin.com'], media: 'page' },
  { name: 'Pinterest', hosts: ['pinterest.com', 'pin.it'], media: 'image' },
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

/** The oEmbed URL to ask, when the provider answers without a key.
 *
 *  `token` is Meta's optional app token: the Graph endpoints answer public
 *  posts without one, and accepting it only raises the rate limit. Passed in
 *  rather than read from the environment so this stays pure. */
export function oembedUrlFor(url: string, token?: string | null): string | null {
  const provider = providerFor(url)
  if (!provider?.oembed) return null
  const meta = provider.oembed.startsWith(GRAPH)
  return `${provider.oembed}?format=json&url=${encodeURIComponent(url)}`
    + (meta && token ? `&access_token=${encodeURIComponent(token)}` : '')
    // Meta returns a whole embed <blockquote> unless told not to; we want the
    // fields, not a script tag we are never going to render
    + (meta ? '&omitscript=true' : '')
}

const decodeEntities = (s: string) => s
  .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

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
  return {
    ...(title || author ? { title: (title ?? author)!.slice(0, 200) } : {}),
    ...(thumb && isSafePreviewUrl(thumb) ? { thumb: thumb.slice(0, 2000) } : {}),
    ...(provider ? { provider: provider.name } : {}),
    media: str(j.type) === 'photo' ? 'image' : provider?.media ?? 'page',
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
  }
  return out.thumb || out.title ? out : null
}

/**
 * A URL that will play inside an iframe, or null.
 *
 * Built ourselves from the video id rather than taken from oEmbed's `html`,
 * because that field is a blob of markup with a script tag in it and injecting
 * a provider's markup into our page is a bigger decision than playing a video.
 * A URL we construct is inert until it is put in a frame.
 *
 * Only the two providers whose embed URL is deterministic. TikTok and
 * Instagram embeds need their own scripts to render, so those cards keep the
 * thumbnail and open the post instead — a play button that opens a tab is
 * honest; one that shows a blank frame is not.
 */
export function embedUrlFor(url: string): string | null {
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

  // TikTok's is keyed on the numeric video id, which is in the canonical URL.
  // A vm.tiktok.com short link has no id until it is followed, so those stay
  // a thumbnail rather than a frame that renders nothing.
  if (host.endsWith('tiktok.com')) {
    const m = /\/video\/(\d+)/.exec(path)
    return m ? `https://www.tiktok.com/embed/v2/${m[1]}` : null
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
