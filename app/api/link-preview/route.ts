import { NextResponse } from 'next/server'
import { requireRole, authzErrorResponse } from '../../lib/authz'
import {
  fromInstagramEmbedHtml, fromMetaTags, fromOembed, instagramEmbedPageUrl, isSafePreviewUrl, isTikTokHost,
  isTikTokShortLink, mergePreview, oembedUrlFor, offlinePreview, parseMetaTags, providerFor,
  tiktokCanonicalUrl, tiktokVideoId,
} from '../../lib/link-preview-core'

/**
 * What is at the end of this link — so a board card can show it.
 *
 * Called once, when a link is dropped on the canvas; the answer is stored on
 * the card. The board never re-resolves on open: a picture that vanishes
 * because a provider rate-limited us is worse than one that is a fortnight
 * stale, and a hundred cards must not mean a hundred outbound requests.
 *
 * ── Why this is a server route and not a fetch from the page ──
 *
 * CORS. Almost nothing sets `access-control-allow-origin: *` on its HTML, so
 * the browser cannot read the tags even when it can reach the page.
 *
 * ── Fetching a URL somebody typed ──
 *
 * This request leaves OUR network, so `isSafePreviewUrl` is a security control
 * and not a nicety: it refuses loopback, link-local (the cloud metadata
 * service), and the private ranges. It is checked again on every redirect hop,
 * because `https://example.com/x` being safe says nothing about where it
 * points — so redirects are followed by hand rather than by fetch.
 */

const HOPS = 3
const TIMEOUT_MS = 4000
/** Enough for a <head>; a preview is never worth reading a whole page. */
const MAX_BYTES = 128 * 1024

/** Some sites serve their Open Graph tags only to something that looks like a
 *  crawler. Saying plainly what we are is both honest and more effective. */
const UA = 'Mozilla/5.0 (compatible; MDMediaBot/1.0; +https://app.mdmmarketing.com.au)'

/** `allowHop` narrows the redirect chain further than the SSRF guard does —
 *  a TikTok short link may only ever lead to TikTok. */
async function get(url: string, accept: string, allowHop?: (u: string) => boolean): Promise<Response | null> {
  let target = url
  for (let hop = 0; hop <= HOPS; hop++) {
    if (!isSafePreviewUrl(target) || (allowHop && !allowHop(target))) return null
    const control = new AbortController()
    const timer = setTimeout(() => control.abort(), TIMEOUT_MS)
    let res: Response
    try {
      res = await fetch(target, {
        redirect: 'manual',
        signal: control.signal,
        headers: { accept, 'user-agent': UA },
      })
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('location')
      if (!next) return null
      try { target = new URL(next, target).toString() } catch { return null }
      // a redirect's body is nothing we want; let the socket go
      void res.body?.cancel().catch(() => {})
      continue
    }
    return res.ok ? res : null
  }
  return null
}

/**
 * The numeric video id behind a `vm.tiktok.com` share link.
 *
 * TikTok's oEmbed refuses the short link outright (400), so the only way to
 * learn what it points at is to follow it — three hops at most, every one of
 * them on TikTok's own hosts, under the same SSRF guard as everything else.
 * The id is read off each hop's URL as it goes by (the first hop is already
 * `m.tiktok.com/v/<id>.html?…&share_item_id=<id>`), so the chain stops the
 * moment it has told us what we came for.
 */
async function tiktokIdViaRedirect(url: string): Promise<string | null> {
  let target = url
  for (let hop = 0; hop <= HOPS; hop++) {
    const id = tiktokVideoId(target)
    if (id) return id
    if (!isSafePreviewUrl(target) || !isTikTokHost(target)) return null
    const control = new AbortController()
    const timer = setTimeout(() => control.abort(), TIMEOUT_MS)
    let res: Response
    try {
      res = await fetch(target, { redirect: 'manual', signal: control.signal, headers: { 'user-agent': UA } })
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
    void res.body?.cancel().catch(() => {})
    if (res.status < 300 || res.status >= 400) return null
    const next = res.headers.get('location')
    if (!next) return null
    try { target = new URL(next, target).toString() } catch { return null }
  }
  return tiktokVideoId(target)
}

/** Read at most MAX_BYTES, so a huge or endless body cannot hold the request. */
async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return (await res.text()).slice(0, MAX_BYTES)
  const decoder = new TextDecoder()
  let out = ''
  while (out.length < MAX_BYTES) {
    const { done, value } = await reader.read()
    if (done) break
    out += decoder.decode(value, { stream: true })
  }
  void reader.cancel().catch(() => {})
  return out.slice(0, MAX_BYTES)
}

export async function POST(req: Request) {
  try {
    // any team member builds a board; no client ever calls this
    await requireRole('scheduler')
    const body = await req.json().catch(() => ({}))
    const url = String((body as { url?: unknown }).url ?? '').trim().slice(0, 2000)

    if (!isSafePreviewUrl(url)) {
      return NextResponse.json({ error: 'Links need to start with https://' }, { status: 400 })
    }

    // free and instant, and it survives the provider blocking us
    const offline = offlinePreview(url)

    // A TikTok share link (vm./vt.tiktok.com) names the video by a code its
    // oEmbed will not accept. Follow it to the id first, then ask oEmbed
    // about THAT — the answer carries the thumbnail, the caption and the
    // author, and its `canonical` is what lets the card play.
    let askUrl = url
    let resolved = null
    if (isTikTokShortLink(url)) {
      const id = await tiktokIdViaRedirect(url)
      if (id) {
        askUrl = tiktokCanonicalUrl(id)
        resolved = { provider: 'TikTok', media: 'video' as const, canonical: askUrl }
      }
    }

    // oEmbed where the provider answers — YouTube, TikTok and Vimeo do with
    // no key; Meta's endpoints only with `META_OEMBED_TOKEN`, and without one
    // `oembedUrlFor` says not to bother asking.
    let oembed = null
    const oembedUrl = oembedUrlFor(askUrl, process.env.META_OEMBED_TOKEN ?? null)
    if (oembedUrl) {
      const res = await get(oembedUrl, 'application/json')
      if (res) {
        const json = await res.json().catch(() => null)
        if (json) oembed = fromOembed(json, askUrl)
      }
    }

    // Instagram's public embed page: the picture, the caption, and — the
    // thing no other source can tell us — whether Instagram itself says the
    // post cannot be framed. Read whenever oEmbed had nothing to say.
    let embedPage = null
    const embedPageUrl = oembed?.thumb ? null : instagramEmbedPageUrl(url)
    if (embedPageUrl) {
      const res = await get(embedPageUrl, 'text/html,application/xhtml+xml')
      if (res) embedPage = fromInstagramEmbedHtml(await readCapped(res))
    }

    let tags = null
    if (!oembed?.thumb && !embedPage?.thumb) {
      const res = await get(url, 'text/html,application/xhtml+xml')
      const type = res?.headers.get('content-type') ?? ''
      if (res && /html|xml/i.test(type)) {
        tags = fromMetaTags(parseMetaTags(await readCapped(res)), url)
      }
    }

    const preview = mergePreview(offline, oembed, embedPage, tags, resolved)
    if (!preview) {
      // Not a failure — plenty of pages tell a robot nothing. An Instagram
      // card still wears Instagram's own embed as its face; anything else
      // stays a chip and offers a cover.
      return NextResponse.json({
        preview: null,
        provider: providerFor(url)?.name ?? null,
        reason: 'no_preview',
      })
    }
    return NextResponse.json({ preview })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
