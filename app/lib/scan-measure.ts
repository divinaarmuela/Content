import 'server-only'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { table } from '@/lib/db'
import type { VideoFrame } from '@/lib/db-types'
import { putObject, r2Configured } from './storage'
import { PROBE_POINTS, PROBE_VERSION, dHashOf, parseDuration, parseProbeLog, type ProbeSample } from './scan-measure-core'

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

/** a frame's fingerprint: ffmpeg shrinks the JPEG to 9×8 grey, and the difference hash is taken of that */
async function hashOf(jpeg: Buffer): Promise<string | null> {
  return new Promise(resolve => {
    const p = spawn(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-i', 'pipe:0', '-vf', 'scale=9:8,format=gray', '-f', 'rawvideo', 'pipe:1'], { stdio: ['pipe', 'pipe', 'ignore'] })
    const out: Buffer[] = []
    const timer = setTimeout(() => p.kill('SIGKILL'), 15_000)
    p.stdout.on('data', (d: Buffer) => out.push(d))
    p.on('close', () => { clearTimeout(timer); resolve(dHashOf(Buffer.concat(out))) })
    p.on('error', () => { clearTimeout(timer); resolve(null) })
    p.stdin.on('error', () => undefined)
    p.stdin.end(jpeg)
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
    let frames = cached.frames as (ProbeSample & { url: string | null })[]
    // measured before frames had fingerprints: take them once from the kept frames, and keep them
    if (frames.some(f => f.url && !f.hash)) {
      frames = await Promise.all(frames.map(async f => {
        if (!f.url || f.hash) return f
        try { const res = await fetch(f.url, { cache: 'no-store' }); return res.ok ? { ...f, hash: await hashOf(Buffer.from(await res.arrayBuffer())) } : f } catch { return f }
      }))
      await table<VideoFrame>('video_frames').update(id, { frames: frames as never, updated_at: new Date().toISOString() } as never).catch(() => undefined)
    }
    return { durationMs: cached.duration_ms ?? null, width: null, height: null, samples: frames, ...(cached.error ? { error: cached.error } : {}) }
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
    const hash = jpeg ? await hashOf(jpeg) : null
    let url: string | null = null
    if (jpeg && r2Configured()) {
      try { url = (await putObject(`scan-frames/${id}-${i}.jpg`, jpeg, 'image/jpeg')).publicUrl } catch { url = null }
    }
    return { ...sample, hash, url }
  }))
  const now = new Date().toISOString()
  await table<VideoFrame>('video_frames').claim(id, () => ({
    id, source: cacheKey.slice(0, 500), duration_ms: meta.durationMs, frames: samples as never, error: null, created_at: now, updated_at: now,
  } as VideoFrame)).catch(() => undefined)
  return { durationMs: meta.durationMs, width: meta.width, height: meta.height, samples }
}

/**
 * THE STORYBOARD — one small frame for every second of a video (up to 120), in one picture, so a cursor moving along
 * its timeline shows the picture at THAT moment, not at twelve fixed points (the owner, 22 Oct 2026: "it should be
 * wherever we drag it not fixed points"). Made once per video in the background: ffmpeg reads only the keyframes
 * (-skip_frame nokey), shrinks them and tiles them 10 across. Kept on the video's `video_frames` row.
 */
export type Storyboard = { url: string; cols: number; rows: number; count: number; every_s: number }
export async function makeStoryboard(cacheKey: string): Promise<{ ok: boolean; note: string }> {
  const id = keyOf(`${PROBE_VERSION}|${cacheKey}`)
  const row = await table<VideoFrame>('video_frames').get(id)
  if (!row?.duration_ms) return { ok: false, note: 'not measured' }
  if ((row as { storyboard?: unknown }).storyboard) return { ok: true, note: 'already' }
  if (!r2Configured()) return { ok: false, note: 'no storage' }
  const src = cacheKey.startsWith('r2:') ? cacheKey.slice(3) : cacheKey.startsWith('drive:') ? drivePublicUrl(cacheKey.split(':')[1]) : null
  if (!src) return { ok: false, note: 'unknown source' }
  const dur = row.duration_ms / 1000
  const count = Math.min(120, Math.max(10, Math.ceil(dur)))
  const cols = 10
  const rows = Math.ceil(count / cols)
  const { out } = await run([
    '-hide_banner', '-nostats', '-skip_frame', 'nokey', '-i', src, '-an',
    '-vf', `fps=${count}/${dur.toFixed(3)},scale=96:-2,tile=${cols}x${rows}`, '-frames:v', '1', '-threads', '2',
    '-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', '5', 'pipe:1',
  ], 280_000)
  if (out.length < 1000) return { ok: false, note: 'ffmpeg made no storyboard' }
  const url = (await putObject(`scan-frames/${id}-board.jpg`, out, 'image/jpeg')).publicUrl
  const storyboard: Storyboard = { url, cols, rows, count, every_s: dur / count }
  await table<VideoFrame>('video_frames').update(id, { storyboard, updated_at: new Date().toISOString() } as never)
  return { ok: true, note: `${count} frames` }
}
