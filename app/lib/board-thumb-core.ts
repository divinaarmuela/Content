/**
 * SMALL COPIES OF BOARD PICTURES — the rules (pure; tests/board-thumb-core.test.ts).
 *
 * WHY (the owner, 26 Nov 2026: a board "lags heavily when going around the canvas" while pictures and links load).
 * Measured on the Alia event brief: 77 pictures, 161 megapixels for the browser to unpack, drawn into 0.4
 * megapixels of screen — full-size phone screenshots (1290 × 2796) shown 250px wide. Moving the board made the
 * browser shrink all of that again and again: about 36 frames a second with stalls of up to 400ms.
 *
 * So a board draws a SMALL COPY of each picture kept in our own storage. The full-size file is still what opens
 * when a card is opened, what is downloaded, and what the document print uses. A picture that lives on another
 * site (a Pinterest or Instagram preview) is drawn from where it lives, as before.
 */

/** The only widths a small copy is made at. A fixed list, so the route cannot be asked for endless sizes. */
export const THUMB_WIDTHS = [640, 1280] as const
export type ThumbWidth = (typeof THUMB_WIDTHS)[number]

/** where small copies are kept, inside the same storage as the pictures */
const THUMB_PREFIX = 'thumb/'
/** still pictures the resizer handles; an animated GIF would stop moving and an SVG is already tiny */
const STILL = /\.(png|jpe?g|webp|avif|heic|heif)$/i

/**
 * A picture's address as 40 hex characters — a NAME for its small copy, the same every time for the same address.
 * Not a secret and not security (the name is public, and what may be fetched is decided by `thumbPlan`'s origin
 * check); five rounds of FNV-1a so this file needs nothing from Node and can be read by the browser too.
 */
function nameOf(text: string): string {
  let out = ''
  for (let round = 0; round < 5; round++) {
    let h = (0x811c9dc5 ^ (round * 0x9e3779b1)) >>> 0
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
    out += h.toString(16).padStart(8, '0')
  }
  return out
}

/**
 * The address a BOARD draws a picture from. `shownWidth` is the card's width in board pixels: up to 480 gets the
 * 640 copy (sharp on a retina screen), wider gets 1280. Anything that is not a still picture in our own storage
 * comes back unchanged.
 */
export function boardThumb(url: string | null | undefined, shownWidth = 0): string {
  if (!url) return ''
  let u: URL
  try { u = new URL(url) } catch { return url }
  // our storage's public address. A custom domain would simply not be shrunk (the route decides for certain).
  if (u.protocol !== 'https:' || !u.hostname.endsWith('.r2.dev')) return url
  if (u.pathname.startsWith(`/${THUMB_PREFIX}`) || !STILL.test(u.pathname)) return url
  const w: ThumbWidth = shownWidth > 480 ? 1280 : 640
  return `/api/img?u=${encodeURIComponent(url)}&w=${w}`
}

export type ThumbPlan = { ok: true; source: string; width: ThumbWidth; key: string } | { ok: false }

/**
 * What the small-copy route will make for a request, or a refusal. The picture must be in OUR storage (`publicBase`,
 * compared as a whole origin, so a look-alike host is refused): the route fetches the address it is given, and it
 * must never become a way to fetch any address on the internet.
 */
export function thumbPlan(rawUrl: string | null | undefined, rawWidth: string | null | undefined, publicBase: string | null | undefined): ThumbPlan {
  if (!rawUrl || !publicBase) return { ok: false }
  let u: URL, base: URL
  try { u = new URL(rawUrl); base = new URL(publicBase) } catch { return { ok: false } }
  if (u.protocol !== 'https:' || u.origin !== base.origin || u.username || u.password) return { ok: false }
  const basePath = base.pathname.replace(/\/$/, '')
  if (basePath && !u.pathname.startsWith(`${basePath}/`)) return { ok: false }
  const inside = u.pathname.slice(basePath.length)
  if (inside.startsWith(`/${THUMB_PREFIX}`) || !STILL.test(inside)) return { ok: false }
  const asked = Number(rawWidth)
  const width: ThumbWidth = (THUMB_WIDTHS as readonly number[]).includes(asked) ? (asked as ThumbWidth) : 640
  const source = `${u.origin}${u.pathname}`
  return { ok: true, source, width, key: `${THUMB_PREFIX}w${width}/${nameOf(source)}.webp` }
}
