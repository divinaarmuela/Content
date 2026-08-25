/**
 * Pure attribution-tracker core — no imports, no I/O, fully unit-testable.
 * Owns slug/click-id alphabets, destination-URL construction, and the mapping
 * from a Zernio webhook event to a registrable asset. The server layer
 * (tracker.ts) does the database work; nothing here touches a network.
 */

/** Unambiguous lowercase alphabet — no 0/o, 1/l/i. These end up read aloud
 *  over the phone and retyped from printed QR captions. */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

/** Deterministic given `randoms` (0..1 values), so tests need no Math.random. */
export function mintCode(randoms: number[], length = 7): string {
  let out = ''
  for (let i = 0; i < length; i++) {
    const r = randoms[i % randoms.length] ?? 0
    out += ALPHABET[Math.floor(Math.abs(r) * ALPHABET.length) % ALPHABET.length]
  }
  return out
}

/**
 * The URL a tracked click is forwarded to.
 *
 * UTMs identify the ASSET (survives Instagram's in-app browser, which strips
 * the referrer but never the query string); mdm_click identifies the CLICK,
 * so an enquiry form that captures its page URL ties the person to the exact
 * click event. Existing query params on the destination are preserved.
 */
export function buildDestUrl(dest: string, assetSlug: string, clickId: string): string {
  let url: URL
  try {
    url = new URL(dest)
  } catch {
    try { url = new URL(`https://${dest}`) } catch { return dest }
  }
  url.searchParams.set('utm_source', 'mdmedia')
  url.searchParams.set('utm_medium', 'content')
  url.searchParams.set('utm_content', assetSlug)
  url.searchParams.set('mdm_click', clickId)
  return url.toString()
}

export type RegistrableAsset = {
  providerPostId: string
  title: string
  platform: string | null
  postUrl: string | null
  source: 'published' | 'external'
  publishedAt: string | null
}

/**
 * A Zernio post webhook event, reduced to what the register stores.
 * Field names follow their payload conventions with fallbacks, because a
 * webhook contract read from documentation deserves defensive parsing.
 * Returns null for events that are not about a publishable post.
 */
export function zernioEventToAsset(event: string, payload: Record<string, unknown>): RegistrableAsset | null {
  if (!/^post\.(published|platform\.published|external\.created|external\.updated)$/.test(event)) {
    return null
  }
  const id = String(payload.id ?? payload.postId ?? payload._id ?? '').trim()
  if (!id) return null

  const platforms = Array.isArray(payload.platforms) ? payload.platforms as Record<string, unknown>[] : []
  const first = platforms[0] ?? {}
  const caption = String(payload.caption ?? payload.content ?? '').trim()

  return {
    providerPostId: id,
    // the caption's first line is the closest thing a post has to a name
    title: caption.split('\n')[0].slice(0, 120) || 'Untitled post',
    platform: String(first.platform ?? payload.platform ?? '').trim() || null,
    postUrl: String(first.platformPostUrl ?? payload.permalink ?? payload.url ?? '').trim() || null,
    source: event.startsWith('post.external') ? 'external' : 'published',
    publishedAt: String(payload.publishedAt ?? payload.published_at ?? '').trim() || null,
  }
}
