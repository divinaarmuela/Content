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
  /**
   * The most this channel is ever worth spending, whatever the arithmetic
   * says — the top of the ladder in `app/lib/media-fit-core.ts`.
   *
   * Optional, because rows and requests written before the machine started
   * sizing the copy itself do not carry it. Without it the number that was
   * sent IS the ceiling, so an older app can only ever have its copy made
   * smaller here, never bigger.
   */
  maxrateCapKbps?: number
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
 * SIZE THE COPY FROM THE LENGTH THE MACHINE ACTUALLY MEASURED.
 *
 * The app has to budget the bitrate before anything has opened the file. When
 * it does not know how long the clip runs — which is the normal case, because
 * the ask is fired the moment the media is attached and the duration is
 * filled in minutes later — it has no choice but to budget for the CHANNEL'S
 * whole length ceiling. An Instagram Reel of unknown length is 300 MB spread
 * over fifteen minutes: about 2 Mbps, against the 8 Mbps a known four-minute
 * clip can afford. That number was then written to the row and rebuilt from
 * the row on every retry, so it could never recover.
 *
 * By the time we are here, ffprobe has told us the truth. So the budget is
 * done again, on the machine, from the real length:
 *
 *   maxrate = min(cap, floor(0.85 x maxMB x 8000 / seconds) - audio)
 *
 * The clip's own length, or the channel's ceiling if it is longer than that —
 * because `ffmpegArgs` also trims to the ceiling, so the finished file is
 * never longer than what was budgeted for. `maxMB` is never exceeded either
 * way: it is the input to the sum, not something the sum can outgrow.
 */
export const BUDGET_HEADROOM = 0.85

/** Never below this: under it the copy is no better than the web-player file
 *  this service exists to replace. The same floor the app uses. */
export const MIN_MAXRATE_KBPS = 1_500

/** The bitrate a clip of this length can afford on this channel. */
export function budgetedMaxrateKbps(
  target: Pick<EncodeTarget, 'maxMB' | 'audioKbps' | 'maxrateKbps' | 'maxrateCapKbps'>,
  seconds: number,
): number {
  const cap = Math.max(1, Math.round(target.maxrateCapKbps ?? target.maxrateKbps))
  if (!Number.isFinite(seconds) || seconds <= 0) return Math.round(target.maxrateKbps)
  const affordable = Math.floor((BUDGET_HEADROOM * target.maxMB * 8000) / seconds) - target.audioKbps
  return Math.max(MIN_MAXRATE_KBPS, Math.min(cap, affordable))
}

/**
 * The target this copy is really made at, once the source has been probed.
 *
 * Applying it twice changes nothing, so a caller that has already done it can
 * hand the result to `ffmpegArgs` safely.
 */
export function targetForSource(
  target: EncodeTarget, source: Pick<SourceInfo, 'durationSec'>,
): EncodeTarget {
  const probed = source.durationSec
  if (!probed || !Number.isFinite(probed) || probed <= 0) return target
  // ceil, so trimming to this number can never cut a frame off a clip that is
  // already short enough
  const seconds = Math.max(1, Math.min(Math.ceil(probed), Math.round(target.maxSeconds)))
  const maxrateKbps = budgetedMaxrateKbps(target, seconds)
  if (seconds === target.maxSeconds && maxrateKbps === target.maxrateKbps) return target
  return { ...target, maxSeconds: seconds, maxrateKbps, bufsizeKbps: maxrateKbps * 2 }
}

/** How long the finished copy runs: the clip, or the channel's ceiling if the
 *  clip is longer than the channel takes. */
export function outputSeconds(
  target: Pick<EncodeTarget, 'maxSeconds'>, source: Pick<SourceInfo, 'durationSec'>,
): number | null {
  const probed = source.durationSec
  if (!probed || !Number.isFinite(probed) || probed <= 0) return null
  return Math.min(probed, target.maxSeconds)
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
 * `-crf 16` with a `-maxrate` ceiling is constrained quality: an easy clip
 * spends less than the ceiling, a hard one is held at it, and neither
 * overruns the channel's size limit because the ceiling was derived from it.
 *
 * It was 20 — the common delivery default — and that was never weighed
 * against what these channels actually allow. Measured on a real post
 * (C0584.MP4, 1080p50, 8 Sep 2026): a 960 MB master came out at 28 MB and
 * 1.95 Mbps, against Instagram's 300 MB ceiling and the ~16 Mbps that
 * ceiling affords over a two-minute clip. Under a tenth of the allowance,
 * with the ceiling nowhere near binding — so the number holding quality
 * down was this one, and nothing else. 18 costs roughly 40 MB on the same
 * clip, still a seventh of what Instagram takes, and buys margin exactly
 * where 20 gets caught out: grain, dark gradients, and fast motion. It went
 * again to 16 the same evening, for the same reason and with better evidence:
 * a 4K event clip encoded at 18 came out at 9,909 kbps against a 10,000
 * ceiling — pressed against the wall, so quality was being decided by OUR
 * limit rather than by the quality target. Nothing here can overflow the
 * channel: `budgetedMaxrateKbps` derives the ceiling from the channel's own
 * size limit and the clip's real length, so the worst case stays under
 * 255 MB against Instagram's 300 whatever CRF asks for.
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
  const { inputPath, outputPath, source } = input
  // the real length decides the bitrate, not the guess the app had to make
  // before anything had opened the file
  const target = targetForSource(input.target, source)
  const { width, height } = targetDimensions(source, target)
  const fps = outputFps(source, target)
  const gop = Math.max(2, Math.round(fps * 2))

  return [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-i', inputPath,

    // -- picture ---------------------------------------------------------
    '-c:v', 'libx264',
    '-profile:v', 'high',
    /* THE LEVEL MUST FOLLOW THE FRAME RATE. Level 4.1 does not cover 1080p
     * above 30 fps — 1080p50 and 1080p60 need 4.2. It was hard-coded 4.1
     * while everything was capped at 30, which was correct; the moment the
     * cap went to 60 (8 Sep 2026) every 50 fps copy carried a label saying
     * "30 fps maximum". Instagram accepted one anyway, but a strict decoder
     * is entitled to refuse it. */
    '-level', fps > 30 ? '4.2' : '4.1',
    // `slow` over `medium`: the same CRF and the same size, spent better —
    // libx264 simply looks harder for the cheap way to describe each frame.
    // It costs encode TIME, and no one is waiting: copies are made when the
    // media is attached, days before the posting time.
    '-preset', 'slow',
    '-crf', '16',
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
    // The channel's length ceiling, as an instruction rather than a hope.
    // Without it a four-minute master posted as an Instagram Story came out
    // at four minutes and ~300 MB, against the 60 seconds and 100 MB the
    // channel takes — the whole size budget quietly wrong.
    '-t', String(target.maxSeconds),
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
