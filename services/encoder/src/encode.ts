import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdtemp, rm, stat, open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import {
  TONE_MAP_FILTER_NAME, TONE_MAP_MISSING_MESSAGE, ffmpegArgs, ffprobeArgs, verifyOutput,
  outputSeconds, parseProbe, targetDimensions, targetForSource, toneMapNeeded,
  videoKbpsOf,
  type EncodeTarget, type SourceInfo,
} from './ladder.js'
import { fileBytes, posterArgs, scrubArgs, type StillsAsk } from './stills.js'

/**
 * One job, start to finish: download, probe, encode, upload, report.
 *
 * Everything here is about NOT leaving anything behind. A 2 GB master and its
 * copy live in a temp directory on a 2 GB machine, so the directory is
 * removed on every exit path — success, failure, timeout, or a source that
 * turned out to be an audio file. `withTempDir` is the only place that
 * removal is written, so a new failure mode cannot forget it.
 *
 * Nothing here ever throws at the caller: a job that fails reports its
 * failure, because the app is waiting for an answer and "no answer" is the
 * one outcome it cannot act on.
 */

/** A source that will not download in ten minutes is not going to. */
export const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000
/** 90 minutes. The old 45 assumed a 1080p master at roughly 1.5x realtime;
 *  this agency shoots 4K, often HDR, where the colour conversion dominates
 *  and a long clip could run past 45 and be killed with nothing to show for
 *  the wait. The machine is four dedicated cores now, so 90 is generous
 *  rather than routine — it exists to free the queue from a stuck ffmpeg,
 *  not to cut an honest encode short. */
export const ENCODE_TIMEOUT_MS = 90 * 60 * 1000
/** The upload is one PUT of a file we already have; it should not need long. */
export const UPLOAD_TIMEOUT_MS = 20 * 60 * 1000

export type EncodeRequest = {
  jobId: string
  sourceUrl: string
  target: EncodeTarget
  /** a presigned R2 PUT — the finished copy goes straight there */
  uploadUrl: string
  callbackUrl: string
  /** where the copy's poster and scrub copy go, when the app wants them (stills.ts) */
  stills?: StillsAsk | null
}

/** Pictures only, of a copy that already exists: how the clips converted before 22 Nov 2026 get theirs. */
export type StillsRequest = {
  jobId: string
  /** the finished copy, in our own storage */
  sourceUrl: string
  callbackUrl: string
  stills: StillsAsk
}

export type EncodeResult = {
  jobId: string
  ok: boolean
  bytes: number | null
  durationSec: number | null
  width: number | null
  height: number | null
  videoKbps: number | null
  error?: string
  /** 1 when the poster and the scrub copy were made and stored; 0 or absent when they were not */
  stills?: number
  /** set on the answer to a pictures-only job, so the app does not read it as a copy finishing */
  only?: 'stills'
}

export type Logger = (message: string, extra?: Record<string, unknown>) => void

/** Every line this service prints carries the job it is about. */
export function loggerFor(jobId: string): Logger {
  return (message, extra) => {
    const detail = extra ? ` ${JSON.stringify(extra)}` : ''
    console.log(`[encode ${jobId}] ${message}${detail}`)
  }
}

/**
 * Which filters this ffmpeg build actually has.
 *
 * Asked once and remembered: `ffmpeg -filters` is a fixed answer for the life
 * of the image, and an HDR master must not be encoded by a build with no
 * `zscale` — that produces the washed-out copy this service exists to
 * prevent. The Docker image verifies the filter at BUILD time as well, so
 * this is the second line of a two-line defence.
 */
let filterCache: Set<string> | null = null
export async function ffmpegFilters(): Promise<Set<string>> {
  if (filterCache) return filterCache
  const listed = await run('ffmpeg', ['-hide_banner', '-filters'], 30_000)
  const names = new Set<string>()
  for (const line of splitLines(listed.stdout)) {
    // "  T.. zscale           V->V       Video resizer and format converter."
    const m = line.match(/^\s*[A-Z.]{3,}\s+([A-Za-z0-9_]+)\s/)
    if (m?.[1]) names.add(m[1])
  }
  filterCache = names
  return names
}

/** Only for tests and for a machine that wants to ask ffmpeg again. */
export function forgetFilters(): void { filterCache = null }

/** Run a child process to completion, with a deadline and a captured stderr. */
function run(
  command: string, args: string[], timeoutMs: number,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let settled = false
    // only the tail of stderr is kept: ffmpeg can print megabytes on a bad
    // input, and the callback carries the reason, not a transcript
    const keepTail = (existing: string, chunk: string) => (existing + chunk).slice(-4000)

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      resolve({ code: -1, stdout, stderr: `${stderr}\ntimed out after ${Math.round(timeoutMs / 1000)}s` })
    }, timeoutMs)

    child.stdout?.on('data', d => { stdout = (stdout + String(d)).slice(0, 2_000_000) })
    child.stderr?.on('data', d => { stderr = keepTail(stderr, String(d)) })
    child.on('error', e => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code: -1, stdout, stderr: `${stderr}\n${(e as Error).message}` })
    })
    child.on('close', code => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code: code ?? -1, stdout, stderr })
    })
  })
}

/** A temp directory that is removed however the body leaves. */
async function withTempDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'encode-'))
  try {
    return await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

async function download(url: string, to: string, log: Logger): Promise<void> {
  const control = new AbortController()
  const timer = setTimeout(() => control.abort(), DOWNLOAD_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: control.signal })
    if (!res.ok) throw new Error(`the source would not download (${res.status})`)
    if (!res.body) throw new Error('the source had no body')
    // the stream, never the bytes: a 2 GB master read into memory on a 2 GB
    // machine is the process being killed with no error anywhere
    await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(to))
  } finally {
    clearTimeout(timer)
  }
  const { size } = await stat(to)
  if (size === 0) throw new Error('the source downloaded as an empty file')
  log('downloaded', { bytes: size })
}

async function upload(url: string, from: string, bytes: number, log: Logger, contentType = 'video/mp4', quiet = false): Promise<void> {
  const control = new AbortController()
  const timer = setTimeout(() => control.abort(), UPLOAD_TIMEOUT_MS)
  const handle = await open(from, 'r')
  try {
    const init = {
      method: 'PUT',
      // the presigned URL was signed for this content type; anything else is
      // rejected by R2 as a signature mismatch
      headers: { 'content-type': contentType, 'content-length': String(bytes) },
      // the stream, not the bytes — the same reason the download is streamed
      body: Readable.toWeb(handle.createReadStream()),
      // Node needs telling that a streamed body is not a duplex request
      duplex: 'half',
      signal: control.signal,
    } as unknown as RequestInit
    const res = await fetch(url, init)
    if (!res.ok) throw new Error(`the copy would not upload (${res.status})`)
  } finally {
    clearTimeout(timer)
    await handle.close().catch(() => {})
  }
  if (!quiet) log('uploaded', { bytes })
}

/** Pictures are small and many; ten minutes is a machine that has stopped. */
export const STILLS_TIMEOUT_MS = 10 * 60 * 1000

/**
 * The poster and the scrub copy of one finished copy, made and stored. Returns 1 when both are, 0 otherwise.
 *
 * BOTH OR NEITHER, and never a throw: the app is told a number, and a number it can trust means the poster and the
 * scrub copy are really there. A clip whose length is not known, an ffmpeg that failed, a PUT that was refused: 0,
 * and the tile stays plain.
 */
export async function makeStills(
  dir: string, video: string, durationSec: number | null, sourceFps: number | null, ask: StillsAsk, log: Logger,
): Promise<number> {
  try {
    const seconds = Number(durationSec)
    if (!(seconds > 0)) { log('no pictures: the length is not known'); return 0 }
    const poster = join(dir, 'poster.jpg')
    const p = await run('ffmpeg', posterArgs(video, poster, seconds), STILLS_TIMEOUT_MS)
    const posterBytes = await fileBytes(poster)
    if (p.code !== 0 || posterBytes === 0) { log('no pictures: the poster could not be cut', { error: lastLine(p.stderr) }); return 0 }
    const scrub = join(dir, 'scrub.mp4')
    const s = await run('ffmpeg', scrubArgs(video, scrub, seconds, sourceFps), STILLS_TIMEOUT_MS)
    const scrubBytes = await fileBytes(scrub)
    if (s.code !== 0 || scrubBytes === 0) { log('no pictures: the scrub copy could not be made', { error: lastLine(s.stderr) }); return 0 }
    await upload(ask.posterUrl, poster, posterBytes, log, 'image/jpeg', true)
    await upload(ask.scrubUrl, scrub, scrubBytes, log, 'video/mp4', true)
    log('pictures stored', { posterBytes, scrubBytes })
    return 1
  } catch (e) {
    log('no pictures', { error: e instanceof Error ? e.message : String(e) })
    return 0
  }
}

/** A pictures-only job, start to finish. Never throws. */
export async function runStills(req: StillsRequest): Promise<EncodeResult> {
  const log = loggerFor(req.jobId)
  const empty = {
    jobId: req.jobId, ok: false, bytes: null, durationSec: null,
    width: null, height: null, videoKbps: null, only: 'stills', stills: 0,
  } satisfies EncodeResult
  try {
    return await withTempDir(async dir => {
      const input = join(dir, 'copy.mp4')
      log('pictures start', { source: safeUrl(req.sourceUrl) })
      await download(req.sourceUrl, input, log)
      const probed = await run('ffprobe', ffprobeArgs(input), 60_000)
      let parsed: unknown = null
      try { parsed = JSON.parse(probed.stdout) } catch { parsed = null }
      const source = probed.code === 0 ? parseProbe(parsed) : null
      if (!source) return { ...empty, error: 'the copy could not be read' }
      const stills = await makeStills(dir, input, source.durationSec ?? null, source.fps ?? null, req.stills, log)
      return { ...empty, ok: stills > 0, durationSec: source.durationSec ?? null, stills, ...(stills > 0 ? {} : { error: 'the pictures could not be made' }) }
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    log('pictures failed', { error: message })
    return { ...empty, error: message }
  }
}

/**
 * Encode one job and return what happened. Never throws.
 */
export async function runEncode(req: EncodeRequest): Promise<EncodeResult> {
  const log = loggerFor(req.jobId)
  const empty = {
    jobId: req.jobId, ok: false, bytes: null, durationSec: null,
    width: null, height: null, videoKbps: null,
  } satisfies EncodeResult

  try {
    return await withTempDir(async dir => {
      const input = join(dir, 'source')
      const output = join(dir, `${req.target.platform}.mp4`)

      log('start', { source: safeUrl(req.sourceUrl), platform: req.target.platform })
      await download(req.sourceUrl, input, log)

      const probed = await run('ffprobe', ffprobeArgs(input), 60_000)
      if (probed.code !== 0) return { ...empty, error: 'the source could not be read' }
      let parsed: unknown
      try { parsed = JSON.parse(probed.stdout) } catch { parsed = null }
      const source: SourceInfo | null = parseProbe(parsed)
      if (!source) return { ...empty, error: 'the source has no video in it' }
      log('probed', { ...source })

      // An HLG or PQ master has to be CONVERTED to BT.709, not relabelled as
      // it. If this build cannot do that, say so plainly and stop — a
      // washed-out copy that publishes is worse than a copy that never does,
      // because nobody finds out until the client does.
      const hdr = toneMapNeeded(source)
      if (hdr) {
        const filters = await ffmpegFilters()
        if (!filters.has(TONE_MAP_FILTER_NAME)) {
          log('cannot tone-map', { transfer: source.colorTransfer })
          return { ...empty, error: TONE_MAP_MISSING_MESSAGE }
        }
        log('tone mapping', { from: hdr })
      }

      /**
       * The target the copy is really made at.
       *
       * The app budgets the bitrate before anything has opened the file, and
       * usually has to guess the length; now that ffprobe has answered, the
       * sum is done again from the truth. `ffmpegArgs` does this itself, and
       * doing it twice changes nothing — it is repeated here so what is
       * LOGGED and REPORTED is what was actually asked for.
       */
      const target = targetForSource(req.target, source)
      if (target.maxrateKbps !== req.target.maxrateKbps || target.maxSeconds !== req.target.maxSeconds) {
        log('re-budgeted for the real length', {
          seconds: source.durationSec, maxrateKbps: target.maxrateKbps, maxSeconds: target.maxSeconds,
          wasKbps: req.target.maxrateKbps, wasSeconds: req.target.maxSeconds,
        })
      }

      const encoded = await run('ffmpeg', ffmpegArgs({ inputPath: input, outputPath: output, target, source }), ENCODE_TIMEOUT_MS)
      if (encoded.code !== 0) {
        return { ...empty, error: `the encode failed: ${lastLine(encoded.stderr) || 'no reason given'}` }
      }

      const { size } = await stat(output)
      const dims = targetDimensions(source, target)

      // the finished file is read back and judged before anyone is told it is
      // ready — see `verifyOutput` for the ways a "successful" encode lies
      const checked = await run('ffprobe', ffprobeArgs(output), 60_000)
      let outProbe: unknown = null
      try { outProbe = JSON.parse(checked.stdout) } catch { outProbe = null }
      const verdict = verifyOutput(outProbe, source, target, dims)
      if (!verdict.ok) {
        log('copy failed its check', { error: verdict.error })
        return { ...empty, error: `the copy failed its check: ${verdict.error}` }
      }
      log('verified', {
        width: verdict.info.width, height: verdict.info.height, fps: verdict.info.fps,
        seconds: verdict.info.durationSec, audio: verdict.info.hasAudio,
      })
      // what the COPY runs for, which is the clip trimmed to the channel's
      // ceiling — the master's own length would misreport the bitrate and
      // send a retry off budgeting for footage that is no longer in the file
      const durationSec = outputSeconds(target, source)
      const result: EncodeResult = {
        jobId: req.jobId,
        ok: true,
        bytes: size,
        durationSec,
        width: dims.width,
        height: dims.height,
        videoKbps: videoKbpsOf(size, durationSec ?? undefined, target.audioKbps),
      }
      log('encoded', { bytes: size, width: dims.width, height: dims.height, videoKbps: result.videoKbps })

      await upload(req.uploadUrl, output, size, log)
      // the copy is safe; now its pictures, which can never cost it (stills.ts)
      if (req.stills) result.stills = await makeStills(dir, output, durationSec, verdict.info.fps ?? null, req.stills, log)
      return result
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    log('failed', { error: message })
    return { ...empty, error: message }
  }
}

/** Nothing that could be a signed URL ever reaches a log line. */
export function safeUrl(url: string): string {
  try {
    const u = new URL(url)
    return `${u.origin}${u.pathname}`
  } catch {
    return '(not a url)'
  }
}

/** Lines, however the platform ended them. */
function splitLines(text: string): string[] {
  return text.split('\n').map(l => l.replace(/\r$/, ''))
}

function lastLine(text: string): string {
  const lines = splitLines(text).map(l => l.trim()).filter(Boolean)
  return lines.length ? lines[lines.length - 1]! : ''
}
