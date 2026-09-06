import { NextResponse } from 'next/server'
import { requireRole, authzErrorResponse } from '../../lib/authz'
import {
  fromInstagramEmbedHtml, fromMetaTags, fromOembed, fromPinterestPageHtml, instagramEmbedPageUrl, isPinterestHost,
  isPinterestShortLink, isSafePreviewUrl, isTikTokHost, isTikTokShortLink, mergePreview, oembedUrlFor, offlinePreview,
  parseMetaTags, pinterestCanonicalUrl, pinterestPinId, providerFor, tiktokCanonicalUrl, tiktokVideoId,
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
/** …except Pinterest's, which injects its `og:` tags and the pin's JSON
 *  past the 1 MB mark of a 1.2 MB page (measured 2026-09-06; ~1.5 s to
 *  fetch). Read once, when the link is dropped, and stored — never again. */
const PINTEREST_MAX_BYTES = 1536 * 1024

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
 * The id behind a share short link.
 *
 * TikTok's oEmbed refuses `vm.tiktok.com/<code>` outright (400), and
 * Pinterest's `pin.it/<code>` chain ends on a page that bounces to an error,
 * so the only way to learn what either points at is to follow it — three
 * hops at most, every one of them on the provider's own hosts (`allowHost`),
 * under the same SSRF guard as everything else. The id is read off each
 * hop's URL as it goes by (TikTok's first hop is already
 * `m.tiktok.com/v/<id>.html?…`; Pinterest's second is
 * `www.pinterest.com/pin/<id>/sent/?…`), so the chain stops the moment it
 * has told us what we came for, and never reads a body.
 */
async function idViaRedirect(
  url: string, readId: (u: string) => string | null, allowHost: (u: string) => boolean,
): Promise<string | null> {
  let target = url
  for (let hop = 0; hop <= HOPS; hop++) {
    const id = readId(target)
    if (id) return id
    if (!isSafePreviewUrl(target) || !allowHost(target)) return null
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
  return readId(target)
}

/** Read at most `cap` bytes, so a huge or endless body cannot hold the request. */
async function readCapped(res: Response, cap = MAX_BYTES): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return (await res.text()).slice(0, cap)
  const decoder = new TextDecoder()
  let out = ''
  while (out.length < cap) {
    const { done, value } = await reader.read()
    if (done) break
    out += decoder.decode(value, { stream: true })
  }
  void reader.cancel().catch(() => {})
  return out.slice(0, cap)
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
      const id = await idViaRedirect(url, tiktokVideoId, isTikTokHost)
      if (id) {
        askUrl = tiktokCanonicalUrl(id)
        resolved = { provider: 'TikTok', media: 'video' as const, canonical: askUrl }
      }
    }

    // A Pinterest link: a `pin.it` code is followed to its id the same way,
    // and stored as the pin's own URL. A full link is asked about by its id
    // alone, so a country host or a `?invite_code=` never reaches a request.
    const pinterest = providerFor(url)?.name === 'Pinterest'
    let pinId: string | null = null
    if (pinterest) {
      pinId = isPinterestShortLink(url) ? await idViaRedirect(url, pinterestPinId, isPinterestHost) : pinterestPinId(url)
      if (pinId) {
        askUrl = pinterestCanonicalUrl(pinId)
        if (askUrl !== url) resolved = { provider: 'Pinterest', media: 'image' as const, canonical: askUrl }
      }
    }

    // oEmbed where the provider answers — YouTube, TikTok, Vimeo and
    // Pinterest do with no key; Meta's endpoints only with
    // `META_OEMBED_TOKEN`, and without one `oembedUrlFor` says not to bother
    // asking. Pinterest's 302s to a country host: followed, on their hosts.
    let oembed = null
    const oembedUrl = pinterest && !pinId ? null : oembedUrlFor(askUrl, process.env.META_OEMBED_TOKEN ?? null)
    if (oembedUrl) {
      const res = await get(oembedUrl, 'application/json', pinterest ? isPinterestHost : undefined)
      if (res) {
        const json = await res.json().catch(() => null)
        if (json) oembed = fromOembed(json, askUrl)
      }
    }

    // The pin page: the only source that says whether a pin is a VIDEO and
    // where its mp4 is, and the one with the full-size picture. Read
    // whole (it is big — PINTEREST_MAX_BYTES) because Pinterest puts the
    // tags at the end; read once, because the answer is stored on the card.
    let pinPage = null
    if (pinId) {
      const res = await get(askUrl, 'text/html,application/xhtml+xml', isPinterestHost)
      if (res) pinPage = fromPinterestPageHtml(await readCapped(res, PINTEREST_MAX_BYTES))
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

    // (a Pinterest link had its page read above, by id; the pasted URL is
    // not fetched again)
    let tags = null
    if (!oembed?.thumb && !embedPage?.thumb && !pinId) {
      const res = await get(url, 'text/html,application/xhtml+xml')
      const type = res?.headers.get('content-type') ?? ''
      if (res && /html|xml/i.test(type)) {
        tags = fromMetaTags(parseMetaTags(await readCapped(res)), url)
      }
    }

    // the pin page first: its picture is full size and it alone knows the
    // video; oEmbed fills in the words and the pinner when the page had none
    const preview = mergePreview(offline, pinPage, oembed, embedPage, tags, resolved)
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
