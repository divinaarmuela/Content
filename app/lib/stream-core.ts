/**
 * What the player should do about a video — decided here, with no I/O.
 *
 * ── The problem this closes ──
 *
 * `video-probe-core` reads a file's first 256 KB and answers "will a browser
 * play this?". For camera footage the answer is routinely no: the `moov`
 * index at the end, HEVC, ProRes. SafeVideo turned the resulting infinite
 * spinner into an honest sentence and a download link — which stopped the
 * "our storage is broken" panic, but a reviewer still could not watch the cut
 * without leaving the dashboard.
 *
 * Cloudflare Stream re-encodes the original into HLS that every browser
 * plays. So the question a player asks is no longer "can I play this?" but
 * "which of the three things do I do?" — play the original, play the encode,
 * or say why not yet. That decision is this module, and it is pure so it can
 * be tested without a network, a database or a DOM.
 *
 * ── The rule, in one line ──
 *
 * The ORIGINAL wins whenever it can play. A fast-start H.264 mp4 is already
 * the best version of itself: full quality, no extra hop, and it plays before
 * Stream has finished thinking about it. Stream is the fallback for files the
 * browser refuses, not a replacement for the ones it accepts.
 *
 * Nothing here reaches for the original file. The R2 object is what the Drive
 * mirror copies and what Instagram posts, always and only.
 */

/** Anything a `<video>` might be asked to play. Docs and decks are not video. */
const VIDEO_URL = /\.(mp4|mov|m4v|webm|avi|mkv|mpe?g|mts|m2ts)(\?|$)/i

export function isVideoUrl(url: string | null | undefined): boolean {
  return VIDEO_URL.test(String(url ?? ''))
}

/**
 * `queued`     — we hold the claim; Stream has not been asked yet, or the
 *                ask failed and the row is waiting to be taken back.
 * `processing` — Stream has a uid and is downloading/encoding.
 * `ready`      — playable.
 * `error`      — Stream gave up, and said why.
 */
export type PreviewState = 'queued' | 'processing' | 'ready' | 'error'

export type PreviewRow = {
  source_url: string
  stream_uid: string | null
  state: PreviewState
  playback_hls: string | null
  thumbnail_url: string | null
  duration_sec?: number | null
  width?: number | null
  height?: number | null
  error?: string | null
}

/** Whatever the probe concluded — `block: null` means "it plays, or no opinion". */
export type ProbeVerdict = { block: { kind: string; reason: string } | null } | null | undefined

export const PREPARING_TEAM = 'Preparing preview — usually under 5 minutes'
export const PREPARING_CLIENT = 'This video is being prepared — check back shortly'

export type PreviewDecision =
  /** the file in R2 plays as it is: use it, exactly as before Stream existed */
  | { at: 'play-native' }
  /** the file does not play, but the encode does */
  | { at: 'play-stream'; uid: string; hls: string; embed: string; poster: string | null }
  /** the file does not play and the encode is not finished */
  | { at: 'pending'; words: string }
  /** the file does not play and no encode is coming — the existing reason card */
  | { at: 'failed' }

/**
 * Which of the four states this video is in, for this viewer.
 *
 * Read the order carefully: the probe is consulted FIRST and its silence is a
 * yes. A file that plays natively never waits on Stream — otherwise every
 * ordinary mp4 in the dashboard would sit behind "preparing preview" for five
 * minutes the first time it was seen, which would be a worse bug than the one
 * this feature fixes.
 */
export function previewStateFor(
  row: PreviewRow | null | undefined,
  probe: ProbeVerdict,
  words: 'team' | 'client' = 'team',
): PreviewDecision {
  // no opinion, or a clean verdict — the original is the best version
  if (!probe?.block) return { at: 'play-native' }

  if (row?.state === 'ready') {
    const embed = streamEmbedUrl(row)
    if (embed && row.playback_hls && row.stream_uid) {
      return {
        at: 'play-stream',
        uid: row.stream_uid,
        hls: row.playback_hls,
        embed,
        poster: streamThumbnailUrl(row),
      }
    }
    // ready with nothing to play it from is a malformed row, not a playable
    // video: fall through and say why rather than render a blank frame
  }

  if (row?.state === 'queued' || row?.state === 'processing') {
    return { at: 'pending', words: words === 'client' ? PREPARING_CLIENT : PREPARING_TEAM }
  }

  return { at: 'failed' }
}

// ── the Cloudflare URL family ─────────────────────────────────────────────

/**
 * The `https://customer-<code>.cloudflarestream.com/<uid>/` every playback
 * URL hangs off, derived from one Cloudflare gave us.
 *
 * Derived rather than assembled from `CLOUDFLARE_ACCOUNT_ID`: the customer
 * subdomain is a separate code from the account id, it is only ever learned
 * from a response, and the shape of these URLs belongs to Cloudflare. Keeping
 * the stored `playback_hls`/`thumbnail_url` verbatim and slicing the base off
 * one of them means a change at their end reaches us for free.
 */
export function streamBaseUrl(row: PreviewRow | null | undefined): string | null {
  const from = row?.playback_hls || row?.thumbnail_url
  const m = /^(https:\/\/customer-[a-z0-9]+\.cloudflarestream\.com\/[A-Za-z0-9]+)\//.exec(String(from ?? ''))
  return m ? m[1] : null
}

/**
 * The player embed.
 *
 * An iframe rather than HLS in a `<video>` because `hls.js` is not a
 * dependency of this app and adding a ~200 KB player library for a fallback
 * path is a poor trade. Safari would play the manifest natively, Chrome and
 * Firefox would not, and "works on the Mac, black on the PC" is the exact
 * failure this feature exists to end. Cloudflare's iframe plays everywhere
 * with no library at all.
 */
export function streamEmbedUrl(row: PreviewRow | null | undefined): string | null {
  const base = streamBaseUrl(row)
  return base ? `${base}/iframe` : null
}

/**
 * A still from the encode — the poster on a board card and on the player
 * before it starts.
 *
 * `time` defaults to one second in: frame zero of a camera clip is very often
 * a black frame or a clapper, and a grid of black rectangles tells a scheduler
 * nothing about which clip is which.
 */
export function streamThumbnailUrl(
  row: PreviewRow | null | undefined,
  opts?: { time?: string; height?: number; width?: number },
): string | null {
  const base = streamBaseUrl(row)
  if (!base) return null
  const q = new URLSearchParams()
  q.set('time', opts?.time ?? '1s')
  if (opts?.height) q.set('height', String(opts.height))
  if (opts?.width) q.set('width', String(opts.width))
  return `${base}/thumbnails/thumbnail.jpg?${q.toString()}`
}

/**
 * The poster for a card: the encode's still when there is one, otherwise
 * whatever the caller already had.
 *
 * A ready encode's thumbnail is the only picture that exists for a HEVC .mov
 * — the browser cannot decode a frame of the original to show one — so this
 * is the difference between a labelled card and a black rectangle.
 */
export function pickPoster(
  row: PreviewRow | null | undefined,
  fallback?: string | null,
): string | null {
  if (row?.state === 'ready') {
    const thumb = streamThumbnailUrl(row)
    if (thumb) return thumb
  }
  return fallback ?? null
}

// ── reading Cloudflare's answers ──────────────────────────────────────────

/** Cloudflare's `status.state` vocabulary, mapped onto ours. */
export function mapStreamState(state: unknown, readyToStream?: unknown): PreviewState {
  const s = String(state ?? '').toLowerCase()
  if (s === 'ready' && readyToStream !== false) return 'ready'
  if (s === 'error') return 'error'
  // pendingupload, downloading, queued, inprogress, live-inprogress, anything
  // new they invent: it is in flight, and the poller should keep asking.
  return 'processing'
}

export type PreviewPatch = {
  stream_uid: string | null
  state: PreviewState
  playback_hls: string | null
  thumbnail_url: string | null
  duration_sec: number | null
  width: number | null
  height: number | null
  error: string | null
}

function positive(n: unknown): number | null {
  const v = Number(n)
  // Cloudflare uses -1 for "not known yet" on duration and on both dimensions
  return Number.isFinite(v) && v > 0 ? v : null
}

/**
 * One Stream video object → the columns of `video_previews`.
 *
 * The same shape arrives three ways — the reply to `POST /stream/copy`, the
 * reply to `GET /stream/{uid}`, and the body of a webhook — so there is one
 * reader for all three and no chance of the poller and the webhook disagreeing
 * about what "ready" means.
 */
export function previewPatchFrom(video: unknown): PreviewPatch | null {
  if (!video || typeof video !== 'object') return null
  const v = video as Record<string, unknown>
  const uid = typeof v.uid === 'string' && v.uid ? v.uid : null
  if (!uid) return null

  const status = (v.status ?? {}) as Record<string, unknown>
  const playback = (v.playback ?? {}) as Record<string, unknown>
  const input = (v.input ?? {}) as Record<string, unknown>
  const state = mapStreamState(status.state, v.readyToStream)

  const reason = [status.errorReasonText, status.errorReasonCode]
    .map(x => (typeof x === 'string' ? x.trim() : ''))
    .find(Boolean)

  return {
    stream_uid: uid,
    state,
    playback_hls: typeof playback.hls === 'string' ? playback.hls : null,
    thumbnail_url: typeof v.thumbnail === 'string' ? v.thumbnail : null,
    duration_sec: positive(v.duration),
    width: positive(input.width),
    height: positive(input.height),
    // an error we cannot name is still an error; a state that is not an error
    // must clear any reason a previous attempt left behind
    error: state === 'error' ? (reason || 'Cloudflare Stream could not encode this file') : null,
  }
}

/**
 * The `Webhook-Signature: time=…,sig1=…` header, split.
 *
 * Returns null for anything malformed rather than throwing: a webhook route
 * that throws on a bad header is a webhook route that returns 500 to a
 * scanner, and Cloudflare retries 500s.
 */
export function parseWebhookSignature(header: string | null | undefined): { time: string; sig: string } | null {
  const parts = String(header ?? '').split(',')
  let time = ''
  let sig = ''
  for (const part of parts) {
    const [k, ...rest] = part.trim().split('=')
    const value = rest.join('=')
    if (k === 'time') time = value
    if (k === 'sig1') sig = value
  }
  if (!/^\d+$/.test(time) || !/^[0-9a-f]{64}$/i.test(sig)) return null
  return { time, sig }
}

/**
 * What Cloudflare signed: the timestamp, a dot, then the body byte-for-byte.
 *
 * The body must be the RAW text of the request. Re-serialising the parsed JSON
 * changes key order and whitespace and produces a signature that will never
 * match — the classic way a webhook verifier ends up rejecting every genuine
 * delivery.
 */
export function webhookSignatureSource(time: string, rawBody: string): string {
  return `${time}.${rawBody}`
}

/**
 * How old a delivery may be before we stop believing it, in seconds.
 *
 * A signature is valid forever without this: anyone who captured one delivery
 * could replay it indefinitely. Five minutes is Cloudflare's own suggestion
 * and is far wider than any real delivery delay.
 */
export const WEBHOOK_MAX_AGE_SEC = 300

export function webhookTimestampFresh(
  time: string, nowMs: number = Date.now(), maxAgeSec: number = WEBHOOK_MAX_AGE_SEC,
): boolean {
  const t = Number(time)
  if (!Number.isFinite(t) || t <= 0) return false
  const ageSec = Math.abs(nowMs / 1000 - t)
  return ageSec <= maxAgeSec
}

// ── the sweep ─────────────────────────────────────────────────────────────

/**
 * Video URLs that ought to have a preview row and do not.
 *
 * The self-healing half of the feature, and the reason it can be trusted: a
 * `requestPreview` call that never left its request — a frozen serverless
 * function, a deploy mid-flight, an upload that predates this feature — leaves
 * no event, no row and no error, so the ONLY way to find it is to recompute
 * what should exist and diff. Exactly `missingItemMirrors`' job for Drive.
 *
 * Deduplicated, because the same file is legitimately a version's slide and a
 * raw asset at once, and capped, because one sweep must never hand Cloudflare
 * a thousand encodes at 3am.
 */
export function missingPreviewSources(
  candidates: readonly (string | null | undefined)[],
  existing: readonly string[],
  cap = 25,
): string[] {
  const have = new Set(existing.map(String))
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of candidates) {
    const url = String(raw ?? '').trim()
    if (!url || !isVideoUrl(url) || have.has(url) || seen.has(url)) continue
    seen.add(url)
    out.push(url)
    if (out.length >= cap) break
  }
  return out
}

/** How long a `processing` row may sit before the poller asks Cloudflare. */
export const POLL_AFTER_MS = 2 * 60 * 1000

/**
 * Rows the backstop poller should ask about.
 *
 * The webhook is the live path and answers in seconds; this only catches the
 * deliveries that never arrived — a webhook never registered, a deploy that
 * was down when it fired, a `queued` row whose copy request failed outright.
 * Two minutes so an encode that finished normally is never polled at all.
 */
export function pollablePreviews<T extends { state: PreviewState; updated_at: string; stream_uid: string | null }>(
  rows: readonly T[], nowMs: number = Date.now(), cap = 20,
): T[] {
  return rows
    .filter(r => (r.state === 'processing' || r.state === 'queued') && Boolean(r.stream_uid))
    .filter(r => {
      const t = new Date(r.updated_at).getTime()
      return !Number.isFinite(t) || nowMs - t >= POLL_AFTER_MS
    })
    .slice(0, cap)
}

/** "3 ready · 1 preparing · 0 failed" — the settings card's one line. */
export function previewCountsLine(counts: { ready: number; preparing: number; failed: number }): string {
  return `${counts.ready} ready · ${counts.preparing} preparing · ${counts.failed} failed (last 7 days)`
}
