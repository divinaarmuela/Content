/**
 * The ladder: what ffmpeg is told, and why.
 *
 * Pure. No files, no processes, no network — every decision this service
 * makes about a video is made here, as data, so it can be read and tested
 * without an encoder anywhere near it. `encode.ts` does the running.
 *
 * The problem this exists to solve: a master over a channel's size limit used
 * to be replaced by Cloudflare Stream's web-player MP4, which is about
 * 0.85 Mbps on a long clip. The platform then re-compressed THAT, and the
 * client saw the loss. A copy made here is 1080p H.264 at 8-12 Mbps, which is
 * what the platform's own encoder expects to be handed.
 *
 * Every number is chosen so the finished file still fits the channel:
 *   (maxrate + audio) x maxSeconds / 8 / 1000  <  maxMB
 * The app derives `maxrateKbps` from that inequality (app/lib/media-fit-core.ts,
 * PLATFORM_ENCODE) and sends it here; this file trusts the number but refuses
 * a target that is missing or nonsensical.
 */

export type EncodeTarget = {
  /** the channel this copy is for — only ever used in logs and the file name */
  platform: string
  /** the channel's file-size ceiling, in MB */
  maxMB: number
  /** the channel's length ceiling, in seconds */
  maxSeconds: number
  /** video bitrate ceiling, in kbps — `-maxrate` */
  maxrateKbps: number
  /** `-bufsize`, normally twice the maxrate */
  bufsizeKbps: number
  /** AAC bitrate, in kbps */
  audioKbps: number
  /**
   * The LONG side of the finished picture, in pixels.
   *
   * "1080p" is a promise about the SHORT side, so both are capped: a 16:9
   * master becomes 1920 x 1080, a 9:16 reel 1080 x 1920, a square 1080 x 1080.
   * `shortSide` defaults to 1080 when the caller does not say.
   */
  longSide: number
  shortSide?: number
  /** frames per second ceiling; the source's own rate is kept below it */
  maxFps?: number
}

export type SourceInfo = {
  width: number
  height: number
  /** the source's frame rate, as a number; unknown is fine */
  fps?: number
  durationSec?: number
  /** ffprobe's `color_transfer` — `arib-std-b67` is HLG, `smpte2084` is PQ */
  colorTransfer?: string
  /** ffprobe's `color_primaries` — `bt2020` on almost anything HDR */
  colorPrimaries?: string
}

export const DEFAULT_SHORT_SIDE = 1080
export const DEFAULT_MAX_FPS = 30

/**
 * The finished file, in MB, if the encoder spent its whole bitrate ceiling
 * for the channel's whole length ceiling. The worst case, in other words.
 */
export function worstCaseMB(
  target: Pick<EncodeTarget, 'maxrateKbps' | 'audioKbps' | 'maxSeconds'>,
): number {
  return ((target.maxrateKbps + target.audioKbps) * target.maxSeconds) / 8 / 1000
}

/** Does this target's ladder actually fit the channel it is for? */
export function fitsBudget(
  target: Pick<EncodeTarget, 'maxrateKbps' | 'audioKbps' | 'maxSeconds' | 'maxMB'>,
): boolean {
  return worstCaseMB(target) < target.maxMB
}

/**
 * The transfer curves that are NOT BT.709 and cannot be treated as if they
 * were.
 *
 * A recent iPhone shoots HLG by default, and this agency shoots on phones. An
 * HLG master encoded with `-color_trc bt709` is BT.2020 pixels wearing a 709
 * label: every platform then renders it grey and desaturated — a WORSE result
 * than the player file this service replaces, on exactly the footage it exists
 * to protect. Tagging is not converting.
 */
export const HDR_TRANSFERS: Record<string, string> = {
  'arib-std-b67': 'HLG',
  'smpte2084': 'PQ (HDR10)',
}

/** Does this source have to be tone-mapped down to BT.709 before encoding? */
export function toneMapNeeded(source: Pick<SourceInfo, 'colorTransfer'>): string | null {
  const transfer = String(source.colorTransfer ?? '').trim().toLowerCase()
  return HDR_TRANSFERS[transfer] ?? null
}

/**
 * The tone map, as one filter.
 *
 * Linearise, convert to float, roll the highlights off with Hable (which keeps
 * skin tones where a simple clip loses them), then land in BT.709 primaries,
 * transfer and matrix. `npl=100` is the nominal peak luminance a phone's HLG
 * is graded against.
 *
 * `format=gbrpf32le` is spelled out rather than left to ffmpeg. `tonemap`
 * accepts only float pixel formats, and filter negotiation does insert the
 * conversion on its own — but nothing here has ever run against a real ffmpeg,
 * the published recipe writes it down, and it costs nothing to be explicit
 * about the one step that turns a client's HDR footage grey if it is missed.
 *
 * It needs libzimg (`zscale`), which Debian's ffmpeg has and a minimal static
 * build often does not — so the service checks for the filter and fails the
 * job in plain words rather than shipping washed-out footage.
 */
export const TONE_MAP_FILTER =
  'zscale=t=linear:npl=100,format=gbrpf32le,tonemap=hable,zscale=p=bt709:t=bt709:m=bt709'

/** The filter this service cannot do without on an HDR master. */
export const TONE_MAP_FILTER_NAME = 'zscale'

/** What a person is told when the machine cannot convert an HDR master. */
export const TONE_MAP_MISSING_MESSAGE =
  'this clip is HDR and this encoder cannot convert it — export a standard (BT.709) version'

/** H.264 wants even dimensions; yuv420p subsamples by two in each direction. */
function even(n: number): number {
  const v = Math.round(n)
  return v % 2 === 0 ? v : v - 1
}

/**
 * What the copy measures.
 *
 * Never upscales — a 720p master stays 720p, because inventing pixels costs
 * bitrate and buys nothing. Aspect is preserved to within a pixel.
 */
export function targetDimensions(
  source: Pick<SourceInfo, 'width' | 'height'>,
  target: Pick<EncodeTarget, 'longSide' | 'shortSide'>,
): { width: number; height: number } {
  const w = Math.max(2, Math.round(source.width))
  const h = Math.max(2, Math.round(source.height))
  const longCap = Math.max(2, target.longSide)
  const shortCap = Math.max(2, target.shortSide ?? DEFAULT_SHORT_SIDE)

  const long = Math.max(w, h)
  const short = Math.min(w, h)
  // the tighter of the two caps decides, so neither is ever exceeded
  const scale = Math.min(1, longCap / long, shortCap / short)
  return { width: even(w * scale), height: even(h * scale) }
}

/**
 * The output frame rate.
 *
 * Constant, always: a variable-rate master handed to a platform's encoder is
 * where audio drift comes from. The source's own rate is kept when it is
 * under the ceiling, so a 24 fps film does not become a 30 fps one.
 */
export function outputFps(
  source: Pick<SourceInfo, 'fps'>,
  target: Pick<EncodeTarget, 'maxFps'>,
): number {
  const cap = target.maxFps ?? DEFAULT_MAX_FPS
  const fps = source.fps
  if (!fps || !Number.isFinite(fps) || fps <= 0) return cap
  // rounded to two places so 30000/1001 does not become an ugly -r argument
  return Math.round(Math.min(fps, cap) * 100) / 100
}

/** A target is only usable if every number in it is a real, positive number. */
export function targetProblem(target: Partial<EncodeTarget> | null | undefined): string | null {
  if (!target || typeof target !== 'object') return 'target is missing'
  const positives = ['maxMB', 'maxSeconds', 'maxrateKbps', 'bufsizeKbps', 'audioKbps', 'longSide'] as const
  for (const key of positives) {
    const value = target[key]
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return `target.${key} must be a positive number`
    }
  }
  if (typeof target.platform !== 'string' || !target.platform.trim()) return 'target.platform is missing'
  if (!/^[a-z0-9_-]{1,32}$/i.test(target.platform)) return 'target.platform is not a channel name'
  const full = target as EncodeTarget
  if (!fitsBudget(full)) {
    return `target would allow ${worstCaseMB(full).toFixed(0)} MB, over the ${full.maxMB} MB this channel takes`
  }
  return null
}

/**
 * Everything ffmpeg is told, in order.
 *
 * `-crf 20` with a `-maxrate` ceiling is constrained quality: an easy clip
 * spends less than the ceiling, a hard one is held at it, and neither
 * overruns the channel's size limit because the ceiling was derived from it.
 *
 * `-g` is two seconds of frames — the keyframe interval every platform's
 * re-encoder is happiest with — and `-sc_threshold 0` stops libx264 adding
 * its own keyframes on cuts, which is what makes the interval a promise.
 */
export function ffmpegArgs(input: {
  inputPath: string
  outputPath: string
  target: EncodeTarget
  source: SourceInfo
}): string[] {
  const { inputPath, outputPath, target, source } = input
  const { width, height } = targetDimensions(source, target)
  const fps = outputFps(source, target)
  const gop = Math.max(2, Math.round(fps * 2))

  return [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-i', inputPath,

    // -- picture ---------------------------------------------------------
    '-c:v', 'libx264',
    '-profile:v', 'high',
    '-level', '4.1',
    '-preset', 'medium',
    '-crf', '20',
    '-maxrate', `${Math.round(target.maxrateKbps)}k`,
    '-bufsize', `${Math.round(target.bufsizeKbps)}k`,
    // lanczos because a 4K master downscaled with the default filter looks
    // soft next to the same frame downscaled in an editor. On an HDR source
    // the tone map comes FIRST: scaling BT.2020 pixels and then labelling the
    // result 709 is the washed-out copy this exists to prevent.
    '-vf', filterChain(width, height, source),
    // BT.709 is what every one of these platforms assumes — and by this point
    // the pixels really are 709, converted rather than relabelled. An untagged
    // file gets guessed at, and the guess is BT.601 often enough to shift skin
    // tones on the client's own footage.
    '-color_primaries', 'bt709',
    '-color_trc', 'bt709',
    '-colorspace', 'bt709',
    '-r', String(fps),
    '-fps_mode', 'cfr',
    '-g', String(gop),
    '-keyint_min', String(gop),
    '-sc_threshold', '0',

    // -- sound -----------------------------------------------------------
    '-c:a', 'aac',
    '-b:a', `${Math.round(target.audioKbps)}k`,
    '-ac', '2',
    '-ar', '48000',

    // -- container -------------------------------------------------------
    // +faststart moves the index to the front so the platform can start
    // reading the file before it has all of it
    '-movflags', '+faststart',
    '-f', 'mp4',
    outputPath,
  ]
}

/** The `-vf` argument: tone map (only when it is needed), scale, then 8-bit 4:2:0. */
export function filterChain(
  width: number, height: number, source: Pick<SourceInfo, 'colorTransfer'>,
): string {
  const parts: string[] = []
  if (toneMapNeeded(source)) parts.push(TONE_MAP_FILTER)
  parts.push(`scale=${width}:${height}:flags=lanczos`)
  parts.push('format=yuv420p')
  return parts.join(',')
}

/** What ffprobe is asked, so the ladder has a picture size to work from. */
export function ffprobeArgs(inputPath: string): string[] {
  return [
    '-hide_banner', '-loglevel', 'error',
    '-print_format', 'json',
    '-show_format',
    // the streams carry `color_transfer`, which is how an HLG master is
    // recognised before it is encoded rather than after a client complains
    '-show_streams',
    inputPath,
  ]
}

type ProbeStream = {
  codec_type?: string
  width?: number
  height?: number
  avg_frame_rate?: string
  r_frame_rate?: string
  duration?: string
  color_transfer?: string
  color_primaries?: string
}

/** Turn one fraction ffprobe prints ("30000/1001") into a number. */
export function parseFrameRate(value: string | undefined): number | undefined {
  if (!value) return undefined
  const [top, bottom] = value.split('/')
  const n = Number(top)
  const d = bottom === undefined ? 1 : Number(bottom)
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0 || n <= 0) return undefined
  return n / d
}

/**
 * The source, as the ladder needs it. Returns null when there is no video
 * stream at all — an audio file or a corrupt download, which must fail the
 * job rather than produce a black rectangle.
 */
export function parseProbe(json: unknown): SourceInfo | null {
  const root = json as { streams?: ProbeStream[]; format?: { duration?: string } } | null
  const streams = Array.isArray(root?.streams) ? root.streams : []
  const video = streams.find(s => s?.codec_type === 'video' && Number(s.width) > 0 && Number(s.height) > 0)
  if (!video) return null
  const durationRaw = Number(root?.format?.duration ?? video.duration)
  const fps = parseFrameRate(video.avg_frame_rate) ?? parseFrameRate(video.r_frame_rate)
  return {
    width: Number(video.width),
    height: Number(video.height),
    ...(fps !== undefined ? { fps } : {}),
    ...(Number.isFinite(durationRaw) && durationRaw > 0 ? { durationSec: durationRaw } : {}),
    ...(video.color_transfer ? { colorTransfer: String(video.color_transfer) } : {}),
    ...(video.color_primaries ? { colorPrimaries: String(video.color_primaries) } : {}),
  }
}

/** The bitrate a finished file actually came out at, for the callback. */
export function videoKbpsOf(
  bytes: number, durationSec: number | undefined, audioKbps: number,
): number | null {
  if (!durationSec || durationSec <= 0 || !Number.isFinite(bytes) || bytes <= 0) return null
  const totalKbps = (bytes * 8) / 1000 / durationSec
  return Math.max(0, Math.round(totalKbps - audioKbps))
}
