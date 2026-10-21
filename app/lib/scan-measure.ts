import 'server-only'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { table } from '@/lib/db'
import type { VideoFrame } from '@/lib/db-types'
import { putObject, r2Configured } from './storage'
import { PROBE_POINTS, PROBE_VERSION, parseDuration, parseProbeLog, type ProbeSample } from './scan-measure-core'

/**
 * MEASURING A VIDEO WITHOUT DOWNLOADING IT (the editor preview's AI scan, 21 Oct 2026). ffmpeg reads a video over
 * HTTP ranges — a public Drive link or our own R2 copy — and at twelve moments takes one small frame, its colour
 * readings (brightness, saturation, black and white points) and two seconds of sound as loudness readings. That is
 * what the comparison and the AI look at: the research (Avid Matchbox, duplicate finders) matches an edit by its sound
 * and cut points, and a grade by its colour — never by the file's name.
 *
 * Tried live first: a 4K, 230 MB clip in a public Drive folder gave a frame in 12 s and its sound in 13 s.
 * Drive is only read (trap 13). The frames are kept in R2 and the readings cached in `video_frames`, so a video on
 * a card is measured once.
 */

function ffmpegPath(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const p = require('ffmpeg-static') as string | null
  if (!p) throw new Error('ffmpeg is not available on this server')
  return p
}

function run(args: string[], timeoutMs = 90_000): Promise<{ out: Buffer; log: string; code: number | null }> {
  return new Promise(resolve => {
    const p = spawn(ffmpegPath(), args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const out: Buffer[] = []
    let log = ''
    const timer = setTimeout(() => p.kill('SIGKILL'), timeoutMs)
    p.stdout.on('data', (d: Buffer) => out.push(d))
    p.stderr.on('data', (d: Buffer) => { log += d.toString(); if (log.length > 400_000) log = log.slice(-200_000) })
    p.on('close', code => { clearTimeout(timer); resolve({ out: Buffer.concat(out), log, code }) })
    p.on('error', () => { clearTimeout(timer); resolve({ out: Buffer.alloc(0), log, code: -1 }) })
  })
}

/** a public Drive file's bytes, as a link ffmpeg can range-read — the same public ask drive-stream.ts makes */
export function drivePublicUrl(driveId: string, resourceKey?: string | null): string {
  const q = new URLSearchParams({ id: driveId, export: 'download', confirm: 't', ...(resourceKey ? { resourcekey: resourceKey } : {}) })
  return `https://drive.usercontent.google.com/download?${q}`
}

export type Probe = { durationMs: number | null; width: number | null; height: number | null; samples: (ProbeSample & { url: string | null })[]; error?: string }

/** one moment: a frame (scaled, its colour readings) and two seconds of sound as loudness every 100 ms */
async function sampleAt(src: string, atS: number, pct: number): Promise<{ sample: ProbeSample; jpeg: Buffer | null }> {
  const { out, log } = await run([
    // the nearest keyframe, not the exact frame: decoding 4K up to an exact moment ran a live scan out of time
    // (21 Oct 2026); the same keyframe is taken from every copy of an edit, so comparisons still line up
    '-hide_banner', '-nostats', '-noaccurate_seek', '-ss', String(Math.max(0, atS)), '-t', '2', '-i', src,
    '-map', '0:v:0', '-frames:v', '1', '-threads', '2', '-vf', 'scale=384:-2,signalstats,metadata=print', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1',
    '-map', '0:a:0?', '-af', 'aresample=8000,asetnsamples=n=800,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level', '-f', 'null', '-',
  ])
  return { sample: { ...parseProbeLog(log), at_pct: pct, at_s: atS }, jpeg: out.length > 500 ? out : null }
}

const keyOf = (source: string) => createHash('sha256').update(source).digest('hex').slice(0, 32)

/**
 * THE MEASURE OF ONE VIDEO, cached by its source — `cacheKey` names the content (an R2 url, or a Drive id with its
 * checksum or size), so a re-export is measured again and the same file never is.
 */
export async function probeVideo(src: string, cacheKey: string): Promise<Probe> {
  const id = keyOf(`${PROBE_VERSION}|${cacheKey}`)
  const cached = await table<VideoFrame>('video_frames').get(id).catch(() => null)
  if (cached && Array.isArray(cached.frames) && cached.frames.length) {
    return { durationMs: cached.duration_ms ?? null, width: null, height: null, samples: cached.frames as never, ...(cached.error ? { error: cached.error } : {}) }
  }
  const head = await run(['-hide_banner', '-i', src], 60_000)
  const meta = parseDuration(head.log)
  if (!meta.durationMs) {
    const error = /403|404|Forbidden|Not Found/i.test(head.log) ? 'The video could not be read — is the link shared as “anyone with the link”?' : 'ffmpeg could not read this video'
    return { durationMs: null, width: null, height: null, samples: [], error }
  }
  const dur = meta.durationMs / 1000
  // four at a time: twelve 4K decodes at once is more than a server function has
  const shots: Awaited<ReturnType<typeof sampleAt>>[] = []
  for (let i = 0; i < PROBE_POINTS.length; i += 4) {
    shots.push(...await Promise.all(PROBE_POINTS.slice(i, i + 4).map(pct => sampleAt(src, Math.min(dur * pct, Math.max(0, dur - 2.2)), pct))))
  }
  const samples = await Promise.all(shots.map(async ({ sample, jpeg }, i) => {
    let url: string | null = null
    if (jpeg && r2Configured()) {
      try { url = (await putObject(`scan-frames/${id}-${i}.jpg`, jpeg, 'image/jpeg')).publicUrl } catch { url = null }
    }
    return { ...sample, url }
  }))
  const now = new Date().toISOString()
  await table<VideoFrame>('video_frames').claim(id, () => ({
    id, source: cacheKey.slice(0, 500), duration_ms: meta.durationMs, frames: samples as never, error: null, created_at: now, updated_at: now,
  } as VideoFrame)).catch(() => undefined)
  return { durationMs: meta.durationMs, width: meta.width, height: meta.height, samples }
}
