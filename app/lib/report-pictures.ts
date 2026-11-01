import 'server-only'
import { createHash } from 'node:crypto'
import { putObject, r2Configured } from './storage'
import type { TopPost } from './client-report-core'

/**
 * A REPORT'S POST PICTURES, KEPT (the owner, 2 Nov 2026: "sometimes thumbnails are missing on why the posts worked").
 * A post Zernio published has its picture on media.zernio.com, which lasts. A post made in Instagram's own app comes
 * with Instagram's CDN address, signed to expire within days (its `oe=` stamp) — saved in a report, it is a blank box
 * by the next week. So those pictures are copied into our own storage when the report is saved, and the copy's
 * address is what the report keeps. A picture that cannot be fetched keeps its address; the page shows a plain
 * "open the post" tile when it fails.
 */

const EXPIRING = /(^|\.)(cdninstagram\.com|fbcdn\.net)$/i

export function expires(url: string | null | undefined): boolean {
  if (!url) return false
  try { return EXPIRING.test(new URL(url).hostname) } catch { return false }
}

async function keep(url: string): Promise<string> {
  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return url
    const type = res.headers.get('content-type') ?? 'image/jpeg'
    if (!type.startsWith('image/')) return url
    const bytes = Buffer.from(await res.arrayBuffer())
    const name = createHash('sha1').update(new URL(url).pathname).digest('hex').slice(0, 20)
    return (await putObject(`report-thumb-${name}.${type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg'}`, bytes, type)).publicUrl
  } catch {
    return url
  }
}

/** the same posts, with every expiring picture swapped for our own lasting copy */
export async function keepPictures<T extends Pick<TopPost, 'thumbnail'>>(posts: T[]): Promise<T[]> {
  if (!r2Configured() || !posts.some(p => expires(p.thumbnail))) return posts
  const out: T[] = []
  for (let i = 0; i < posts.length; i += 4) {
    out.push(...await Promise.all(posts.slice(i, i + 4).map(async p => (expires(p.thumbnail) ? { ...p, thumbnail: await keep(p.thumbnail!) } : p))))
  }
  return out
}
