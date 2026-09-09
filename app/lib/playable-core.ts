/**
 * WHICH FILE A BROWSER SHOULD PLAY — the pure half.
 *
 * The master is what the person uploaded, often a .mov straight off the
 * camera (ProRes, HEVC) that Chrome cannot decode: every preview of it — the
 * drawer, the post window, the week's tiles — was a black box or a broken
 * player (the owner, 10 Sep 2026: "no more broken videos"). The encoder has
 * usually already made an H.264 .mp4 copy of that master for a channel, and
 * that copy plays anywhere. So a preview asks for the copy first.
 */

export type EncodeRowLike = {
  source_url?: string | null
  output_key?: string | null
  status?: string | null
  platform?: string | null
}

const VIDEO_EXT = /\.(mov|mp4|m4v|webm|avi|mkv|mts|m2ts)(\?|#|$)/i

/** the copies most likely to play well in a browser, first */
const PREFER = ['instagram', 'facebook', 'tiktok', 'youtube', 'linkedin', 'twitter']

export function isVideoUrl(url: string): boolean {
  return VIDEO_EXT.test(url)
}

/**
 * The URL to hand a `<video>`: a finished encoder copy of the master when
 * there is one (it sits beside the master in the same public bucket), the
 * master itself otherwise. A picture, or anything not recognised as a
 * video, comes back untouched.
 */
export function playableUrl(master: string, rows: readonly EncodeRowLike[] | null | undefined): string {
  if (!master || !isVideoUrl(master)) return master
  const done = (rows ?? []).filter(r =>
    r && r.source_url === master && r.status === 'done' && typeof r.output_key === 'string' && r.output_key)
  if (done.length === 0) return master
  done.sort((a, b) => rank(a.platform) - rank(b.platform))
  const key = String(done[0].output_key)
  const cut = master.lastIndexOf('/')
  return cut > 0 ? `${master.slice(0, cut + 1)}${key}` : key
}

function rank(platform: string | null | undefined): number {
  const i = PREFER.indexOf(String(platform ?? '').toLowerCase())
  return i === -1 ? PREFER.length : i
}

/** what to say under a video the browser cannot decode */
export const CANNOT_PLAY_HERE =
  'This file cannot be played in the browser (a camera .mov, usually). It still posts — each channel gets an .mp4 copy.'
