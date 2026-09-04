import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdtemp, rm, stat, open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import {
  TONE_MAP_FILTER_NAME, TONE_MAP_MISSING_MESSAGE, ffmpegArgs, ffprobeArgs,
  parseProbe, targetDimensions, toneMapNeeded, videoKbpsOf,
  type EncodeTarget, type SourceInfo,
} from './ladder.js'

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
/** 45 minutes covers a 10-minute master at roughly 1.5x realtime, twice over. */
export const ENCODE_TIMEOUT_MS = 45 * 60 * 1000
/** The upload is one PUT of a file we already have; it should not need long. */
export const UPLOAD_TIMEOUT_MS = 20 * 60 * 1000

export type EncodeRequest = {
  jobId: string
  sourceUrl: string
  target: EncodeTarget
  /** a presigned R2 PUT — the finished copy goes straight there */
  uploadUrl: string
  callbackUrl: string
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

async function upload(url: string, from: string, bytes: number, log: Logger): Promise<void> {
  const control = new AbortController()
  const timer = setTimeout(() => control.abort(), UPLOAD_TIMEOUT_MS)
  const handle = await open(from, 'r')
  try {
    const init = {
      method: 'PUT',
      // the presigned URL was signed for this content type; anything else is
      // rejected by R2 as a signature mismatch
      headers: { 'content-type': 'video/mp4', 'content-length': String(bytes) },
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
  log('uploaded', { bytes })
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

      const encoded = await run('ffmpeg', ffmpegArgs({ inputPath: input, outputPath: output, target: req.target, source }), ENCODE_TIMEOUT_MS)
      if (encoded.code !== 0) {
        return { ...empty, error: `the encode failed: ${lastLine(encoded.stderr) || 'no reason given'}` }
      }

      const { size } = await stat(output)
      const dims = targetDimensions(source, req.target)
      const durationSec = source.durationSec ?? null
      const result: EncodeResult = {
        jobId: req.jobId,
        ok: true,
        bytes: size,
        durationSec,
        width: dims.width,
        height: dims.height,
        videoKbps: videoKbpsOf(size, source.durationSec, req.target.audioKbps),
      }
      log('encoded', { bytes: size, width: dims.width, height: dims.height, videoKbps: result.videoKbps })

      await upload(req.uploadUrl, output, size, log)
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
