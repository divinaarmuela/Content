/**
 * Why a 184 MB .mov spins forever and a 40 MB .mp4 plays instantly.
 *
 * An MP4/MOV file is a flat list of boxes. Two of them matter here: `mdat`
 * holds the actual picture, and `moov` holds the index that says WHERE in
 * `mdat` every frame lives. A browser cannot show frame one until it has the
 * index — so when an exporter writes `mdat` first and `moov` last (the
 * default in Premiere, After Effects and QuickTime for .mov), the player has
 * to download the entire file before the first pixel appears. Range requests
 * do not save it: the player does not know what to ask for. "Fast start" is
 * the same file with `moov` moved to the front, and it plays in a second.
 *
 * The second way a file is unplayable is its codec. Chrome and Edge on
 * Windows decode H.264 and not HEVC; nothing in any browser decodes ProRes.
 * Both are `.mov` files with a correct Content-Type, so nothing upstream of
 * the player can tell.
 *
 * This module reads both facts out of the first ~256 KB of the bytes. Pure:
 * a Uint8Array in, a verdict out. No fetch, no DOM, no File.
 */

export type VideoContainer = 'mp4' | 'mov' | 'other'
export type VideoCodec = 'h264' | 'hevc' | 'prores' | 'av1' | 'vp9' | 'other'

export type VideoProbe = {
  container: VideoContainer
  /**
   * true  — `moov` comes before `mdat`: it plays as soon as it starts.
   * false — `moov` was found AFTER `mdat`: the whole file must arrive first.
   * null  — undetermined, because `mdat` runs past the bytes we probed and
   *         `moov` was never seen. Treat it exactly like false: the reason a
   *         probe cannot see the index is that the index is a long way away.
   */
  fastStart: boolean | null
  /** the ftyp major brand — `qt  `, `isom`, `mp42`… — when there is one */
  brand: string | null
  /** only known when `moov` fell inside the probed bytes */
  codec: VideoCodec | null
  /** the raw four-character sample format: `avc1`, `hvc1`, `ap4h`… */
  codecTag: string | null
}

/** How many bytes a caller should hand us. R2 serves this range happily. */
export const PROBE_BYTES = 262144

const UNKNOWN: VideoProbe = {
  container: 'other', fastStart: null, brand: null, codec: null, codecTag: null,
}

/** Box types that legally open a QuickTime file that carries no `ftyp`. */
const QT_TOP = new Set(['moov', 'mdat', 'wide', 'free', 'skip', 'pnot'])

/** Boxes we descend INTO on the way to the sample description. */
const NESTED = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'mvex'])

const CODEC_TAGS: Record<string, VideoCodec> = {
  avc1: 'h264', avc3: 'h264', h264: 'h264',
  hvc1: 'hevc', hev1: 'hevc', hvc2: 'hevc', dvh1: 'hevc', dvhe: 'hevc',
  ap4h: 'prores', ap4x: 'prores', apch: 'prores', apcn: 'prores',
  apcs: 'prores', apco: 'prores', aprh: 'prores', aprn: 'prores',
  av01: 'av1', vp09: 'vp9',
}

/** Sample formats that are a soundtrack, a timecode or subtitles — never the
 *  picture, and never the reason a video will not play. */
const NOT_VIDEO = new Set([
  'mp4a', 'sowt', 'twos', 'lpcm', 'alac', 'in24', 'in32', 'fl32', 'fl64',
  'ac-3', 'ec-3', 'Opus', 'tmcd', 'text', 'sbtl', 'c608', 'c708', 'mebx',
])

function u32(b: Uint8Array, at: number): number {
  return b[at] * 0x1000000 + ((b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3])
}

function u64(b: Uint8Array, at: number): number {
  // JS numbers hold every file size that exists; the high word is the guard
  return u32(b, at) * 0x100000000 + u32(b, at + 4)
}

function typeAt(b: Uint8Array, at: number): string {
  let s = ''
  for (let i = 0; i < 4; i++) s += String.fromCharCode(b[at + i])
  return s
}

/** A box type is four printable characters. Anything else means we have lost
 *  the thread and are reading picture data as if it were structure. */
function plausibleType(t: string): boolean {
  return /^[\x20-\x7e]{4}$/.test(t)
}

type Box = { type: string; start: number; size: number; header: number }

/** The box at `at`, or null when the bytes there are not a box we can trust. */
function readBox(b: Uint8Array, at: number, end: number): Box | null {
  if (at + 8 > end) return null
  const type = typeAt(b, at + 4)
  if (!plausibleType(type)) return null
  const declared = u32(b, at)
  let size = declared
  let header = 8
  if (declared === 1) {
    if (at + 16 > end) return null
    size = u64(b, at + 8)
    header = 16
  } else if (declared === 0) {
    // "runs to the end of the file" — the last box, whatever length that is
    size = Number.POSITIVE_INFINITY
  }
  if (size < header) return null
  return { type, start: at, size, header }
}

/**
 * The first video sample format inside a (possibly truncated) `moov`.
 *
 * Descends moov → trak → mdia → minf → stbl → stsd, clamping every box to
 * the bytes we actually hold, so half a `moov` still answers the question.
 */
function findVideoFormat(b: Uint8Array, from: number, to: number, depth = 0): string | null {
  if (depth > 6) return null
  let at = from
  let guard = 0
  while (at + 8 <= to && guard++ < 256) {
    const box = readBox(b, at, to)
    if (!box) return null
    const payload = at + box.header
    const stop = Math.min(box.size === Number.POSITIVE_INFINITY ? to : at + box.size, to)
    if (box.type === 'stsd') {
      // FullBox: version+flags (4), entry_count (4), then size+format entries
      let entry = payload + 8
      let n = 0
      while (entry + 8 <= stop && n++ < 32) {
        const entrySize = u32(b, entry)
        const format = typeAt(b, entry + 4)
        if (!plausibleType(format)) break
        if (!NOT_VIDEO.has(format)) return format
        if (entrySize < 8) break
        entry += entrySize
      }
    } else if (NESTED.has(box.type)) {
      const found = findVideoFormat(b, payload, stop, depth + 1)
      if (found) return found
    }
    if (box.size === Number.POSITIVE_INFINITY) return null
    at += box.size
  }
  return null
}

/**
 * Read the container, the fast-start answer and (when the index is close
 * enough to see) the codec out of the head of an MP4/MOV file.
 *
 * Never throws. Anything it cannot parse comes back as `container: 'other'`
 * with `fastStart: null`, which callers read as "no opinion" — a WebM or a
 * JPEG must not be accused of being a slow .mov.
 */
export function probeVideoBytes(input: Uint8Array | ArrayBuffer): VideoProbe {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input)
  const len = b.length
  if (len < 8) return UNKNOWN

  const first = readBox(b, 0, len)
  if (!first) return UNKNOWN

  let container: VideoContainer
  let brand: string | null = null
  if (first.type === 'ftyp') {
    brand = first.start + 12 <= len ? typeAt(b, first.start + 8) : null
    container = brand?.trim().toLowerCase() === 'qt' ? 'mov' : 'mp4'
  } else if (QT_TOP.has(first.type)) {
    container = 'mov'
  } else {
    return UNKNOWN
  }

  let sawMdat = false
  let fastStart: boolean | null = null
  let codec: VideoCodec | null = null
  let codecTag: string | null = null

  let at = 0
  let guard = 0
  while (at + 8 <= len && guard++ < 128) {
    const box = readBox(b, at, len)
    if (!box) break
    if (box.type === 'moov') {
      fastStart = !sawMdat
      const stop = Math.min(box.size === Number.POSITIVE_INFINITY ? len : at + box.size, len)
      const tag = findVideoFormat(b, at + box.header, stop)
      if (tag) {
        codecTag = tag
        codec = CODEC_TAGS[tag] ?? 'other'
      }
      break
    }
    if (box.type === 'mdat') {
      sawMdat = true
      // the index is somewhere past the far side of the picture data, and
      // the far side is past the bytes we hold: undetermined, which is the
      // same practical answer as "not fast start"
      if (box.size === Number.POSITIVE_INFINITY || at + box.size > len) break
    }
    if (box.size === Number.POSITIVE_INFINITY) break
    at += box.size
  }

  return { container, fastStart, brand, codec, codecTag }
}

/** "184 MB" / "976 KB" — the number in the sentence about why it will not play. */
export function formatFileSize(bytes: number | null | undefined): string | null {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n <= 0) return null
  if (n < 1024) return `${Math.round(n)} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  if (n < 1024 * 1024 * 1024) return `${Math.round(n / (1024 * 1024))} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export type PreviewBlock = {
  /** which of the two problems this is — the UI colours nothing on it, but
   *  the uploader warning and the player card word themselves differently */
  kind: 'fast-start' | 'codec'
  /** finishes the sentence "This file can't preview in the browser — …" */
  reason: string
}

/**
 * Why this file will not play in a browser, or null when it will.
 *
 * `fastStart: null` counts as a block: see the note on the field. A container
 * we do not recognise is never blocked — a WebM or an unrecognised header
 * gets its chance in the `<video>` element, and the stall fallback catches it
 * if that chance was misplaced.
 */
export function previewBlock(
  probe: VideoProbe | null | undefined,
  bytes?: number | null,
): PreviewBlock | null {
  if (!probe || probe.container === 'other') return null
  if (probe.codec === 'prores') {
    return { kind: 'codec', reason: "it's ProRes, which no browser can decode" }
  }
  if (probe.codec === 'hevc') {
    return { kind: 'codec', reason: "it's HEVC, which Chrome and Edge can't decode" }
  }
  if (probe.fastStart !== true) {
    const size = formatFileSize(bytes)
    return {
      kind: 'fast-start',
      reason: `its index is at the end, so it must download fully first${size ? ` (${size})` : ''}`,
    }
  }
  return null
}

/** How to stop making files like this — the same two sentences everywhere. */
export const EXPORT_ADVICE =
  'For previews export .mp4 H.264 with Fast Start '
  + "(Premiere: Format H.264, tick 'Web optimized' — Handbrake: 'Web Optimized')."

/**
 * The yellow line under a file that was just chosen for upload.
 *
 * It never blocks: the file uploads, mirrors to Drive and posts exactly as
 * before. What it buys is that the editor learns at 9am, on their own export,
 * rather than from a super admin who cannot play the review link at 5pm.
 */
export function uploadWarning(
  probe: VideoProbe | null | undefined,
  bytes?: number | null,
): string | null {
  const block = previewBlock(probe, bytes)
  if (!block) return null
  return `Won't preview in the browser: ${block.reason}. It still uploads and posts fine. ${EXPORT_ADVICE}`
}
