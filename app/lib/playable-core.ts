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

/* ── WHAT THE POST WINDOW SHOWS FOR A VIDEO (1 Oct 2026) ──────────────────────────────────────────
 * A draft made from an edit card's .mov original drew an empty black box with a film icon: Chrome
 * cannot decode the .mov, and a draft with no channels has no encoder copy yet. The editor's card
 * already has a Cloudflare Stream preview of the same file (usePreviewRows), so the window shows that;
 * with none yet it shows the file's still and says the preview is being made. ONLY WHAT IS SHOWN —
 * what is published is the post's slides, untouched.
 */

/** the originals a browser cannot be trusted to decode — a camera .mov above all */
const NEEDS_COPY_EXT = /\.(mov|avi|mkv|mts|m2ts)(\?|#|$)/i
export function needsPreviewCopy(url: string): boolean {
  return NEEDS_COPY_EXT.test(String(url ?? ''))
}

export const MOV_PREVIEW_WAIT = 'Preview being made — the original is a .mov'

/** A Cloudflare Stream preview row, as much of it as this needs (stream-core PreviewRow). */
export type StreamRowLike = {
  state?: string | null
  playback_hls?: string | null
  thumbnail_url?: string | null
}

export type ShownVideo =
  /** the encoder's .mp4 copy, or an original the browser plays */
  | { kind: 'file'; src: string }
  /** Cloudflare Stream's preview of the original — an adaptive stream every browser plays */
  | { kind: 'stream'; hls: string; poster: string | null }
  /** a .mov with no copy and no preview yet: its still, if there is one, and the words */
  | { kind: 'waiting'; poster: string | null; words: string }

const STREAM_BASE = /^(https:\/\/customer-[a-z0-9]+\.cloudflarestream\.com\/[A-Za-z0-9]+)\//

/**
 * Which picture of a video the window draws: the encoder's copy when there is one, else Cloudflare's
 * preview when it is ready, else — for a .mov — its still (`thumb`: the Drive thumbnail of a file handed
 * in from Drive) and MOV_PREVIEW_WAIT; anything else plays as it is.
 */
export function shownVideo(input: {
  url: string
  encodeRows?: readonly EncodeRowLike[] | null
  stream?: StreamRowLike | null
  thumb?: string | null
}): ShownVideo {
  const copy = playableUrl(input.url, input.encodeRows)
  if (copy !== input.url) return { kind: 'file', src: copy }
  const row = input.stream
  const base = row?.state === 'ready' ? STREAM_BASE.exec(String(row.playback_hls || row.thumbnail_url || ''))?.[1] ?? null : null
  if (base) return { kind: 'stream', hls: `${base}/manifest/video.m3u8`, poster: `${base}/thumbnails/thumbnail.jpg?time=1s` }
  if (needsPreviewCopy(input.url)) return { kind: 'waiting', poster: input.thumb ?? null, words: MOV_PREVIEW_WAIT }
  return { kind: 'file', src: input.url }
}

/** what to say under a video the browser cannot decode */
export const CANNOT_PLAY_HERE =
  'This file cannot be played in the browser (a camera .mov, usually). It still posts — each channel gets an .mp4 copy.'
