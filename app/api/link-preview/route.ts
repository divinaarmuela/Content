import { NextResponse } from 'next/server'
import { requireRole, authzErrorResponse } from '../../lib/authz'
import {
  fromMetaTags, fromOembed, isSafePreviewUrl, mergePreview, oembedUrlFor,
  offlinePreview, parseMetaTags, providerFor,
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

async function get(url: string, accept: string): Promise<Response | null> {
  let target = url
  for (let hop = 0; hop <= HOPS; hop++) {
    if (!isSafePreviewUrl(target)) return null
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
      continue
    }
    return res.ok ? res : null
  }
  return null
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

    // oEmbed where the provider still answers without a key — YouTube, TikTok
    // and Vimeo do. Instagram and Facebook withdrew theirs, so those fall
    // through to the page's own tags and often learn nothing.
    let oembed = null
    // optional everywhere: Meta's endpoints answer public posts without it and
    // it only buys a higher rate limit, so an unset variable costs nothing
    const oembedUrl = oembedUrlFor(url, process.env.META_OEMBED_TOKEN ?? null)
    if (oembedUrl) {
      const res = await get(oembedUrl, 'application/json')
      if (res) {
        const json = await res.json().catch(() => null)
        if (json) oembed = fromOembed(json, url)
      }
    }

    let tags = null
    if (!oembed?.thumb) {
      const res = await get(url, 'text/html,application/xhtml+xml')
      const type = res?.headers.get('content-type') ?? ''
      if (res && /html|xml/i.test(type)) {
        tags = fromMetaTags(parseMetaTags(await readCapped(res)), url)
      }
    }

    const preview = mergePreview(offline, oembed, tags)
    if (!preview) {
      // Not a failure — plenty of pages tell a robot nothing, and Meta tells
      // us nothing on purpose. The card stays a chip and offers a cover.
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
