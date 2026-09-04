import 'server-only'
import { createHash } from 'node:crypto'
import { table } from '@/lib/db'
import type { EncodeJob } from '@/lib/db-types'
import { publicBase } from './storage'
import type { Platform } from './publish-core'

/**
 * The `encode_jobs` row: one request for one publish-grade copy.
 *
 * ── Why there is a row at all ──
 *
 * "Is a clean copy of this file being made?" has to have ONE answer that
 * survives a deploy, a retry, and a second person opening the composer on the
 * same post. Without a row, two people looking at the same 2 GB master would
 * start two encodes of it, and a publish job would have nothing to wait on
 * but a poll.
 *
 * ── Why the id is derived, not random ──
 *
 * The id IS the claim. `<source url>__<platform>` means the SAME copy can
 * only ever be asked for once, because a second ask lands on a row that
 * already exists and loses the compare-and-set. This is the same discipline
 * as `video_previews.source_url` and `drive_files (source_url, target)`, and
 * for the same reason: an encode is minutes of a machine's time, so a
 * duplicate is a real cost, not just an untidy table.
 *
 * Never check-then-write (CLAUDE.md trap 11): every state change here is a
 * `claim()`, so two callers cannot both believe they started the job, and a
 * late callback cannot overwrite a job somebody already failed.
 */

export type EncodeStatus = 'queued' | 'running' | 'done' | 'failed'

/**
 * `<hash of the source url>__<platform>`.
 *
 * A hash rather than the URL itself for two reasons: an RTDB key may not
 * contain `. # $ [ ] /` (CLAUDE.md trap 9), and this id travels to the
 * encoder and back inside a JSON body, where a 300-character key made of
 * percent escapes is a liability. The row carries `source_url` in full, so
 * nothing is lost — only shortened.
 */
export function encodeJobId(sourceUrl: string, platform: Platform): string {
  const digest = createHash('sha256').update(sourceUrl).digest('hex').slice(0, 32)
  return `${digest}__${platform}`
}

/** Where the finished copy is readable, or null while there isn't one. */
export function copyUrlOf(row: Pick<EncodeJob, 'output_key'> | null | undefined): string | null {
  const base = publicBase()
  if (!base || !row?.output_key) return null
  return `${base}/${row.output_key}`
}

export async function getEncodeJob(sourceUrl: string, platform: Platform): Promise<EncodeJob | null> {
  return table<EncodeJob>('encode_jobs').get(encodeJobId(sourceUrl, platform)).catch(() => null)
}

export type EncodeJobOrigin = {
  /** the piece of work this video belongs to, when it belongs to one */
  assetId?: string | null
  versionId?: string | null
  slideIndex?: number | null
}

/**
 * Take the job, or find out who already has it.
 *
 * `at: 'claimed'` means this caller owns the encode and must now ask the
 * encoder for it. `at: 'existing'` means somebody else did, and `row` says
 * where they got to — including a `failed` row, which is terminal: a source
 * that could not be encoded will not encode differently on a second try, and
 * a job that re-queued itself on failure would spend a machine's afternoon
 * discovering that.
 */
export async function claimEncodeJob(input: {
  sourceUrl: string
  platform: Platform
} & EncodeJobOrigin): Promise<{ at: 'claimed' | 'existing'; row: EncodeJob }> {
  const id = encodeJobId(input.sourceUrl, input.platform)
  const now = new Date().toISOString()
  const taken = await table<EncodeJob>('encode_jobs').claim(id, current =>
    current ? null : {
      id,
      source_url: input.sourceUrl,
      platform: input.platform,
      asset_id: input.assetId ?? null,
      version_id: input.versionId ?? null,
      slide_index: input.slideIndex ?? null,
      status: 'queued',
      output_key: null,
      bytes: null,
      width: null,
      height: null,
      duration_sec: null,
      video_kbps: null,
      error: null,
      created_at: now,
      updated_at: now,
    })

  if (taken.claimed) return { at: 'claimed', row: taken.row }
  // lost the claim: whoever won it wrote the row we now read back. `get`
  // throws rather than returning null when the row is not there, and a row
  // that is not there after losing a claim for it is a database that lied.
  const current = taken.current ?? (await table<EncodeJob>('encode_jobs').get(id))
  if (!current) throw new Error('the copy job vanished between claiming it and reading it')
  return { at: 'existing', row: current }
}

/** The encoder took the job. queued → running, and only from queued. */
export async function markEncodeRunning(id: string): Promise<boolean> {
  const moved = await table<EncodeJob>('encode_jobs').claim(id, cur =>
    cur && cur.status === 'queued'
      ? { ...cur, status: 'running', updated_at: new Date().toISOString() }
      : null)
  return moved.claimed
}

/**
 * The job is over, one way or the other.
 *
 * Only a job that is still queued or running can be settled, so a duplicate
 * callback (the encoder retries its report) lands on a row that is already
 * done and changes nothing — `settled: false` says exactly that, and is not
 * an error.
 */
export async function settleEncodeJob(input: {
  id: string
  ok: boolean
  outputKey?: string | null
  bytes?: number | null
  width?: number | null
  height?: number | null
  durationSec?: number | null
  videoKbps?: number | null
  error?: string | null
}): Promise<{ settled: boolean; row: EncodeJob | null }> {
  const live: EncodeStatus[] = ['queued', 'running']
  const moved = await table<EncodeJob>('encode_jobs').claim(input.id, cur => {
    if (!cur || !live.includes(cur.status as EncodeStatus)) return null
    return {
      ...cur,
      status: input.ok ? 'done' : 'failed',
      output_key: input.ok ? (input.outputKey ?? cur.output_key) : cur.output_key,
      bytes: input.bytes ?? cur.bytes,
      width: input.width ?? cur.width,
      height: input.height ?? cur.height,
      duration_sec: input.durationSec ?? cur.duration_sec,
      video_kbps: input.videoKbps ?? cur.video_kbps,
      error: input.ok ? null : (input.error ?? 'the encode failed'),
      updated_at: new Date().toISOString(),
    }
  })
  if (moved.claimed) return { settled: true, row: moved.row }
  return { settled: false, row: moved.current }
}

/**
 * Where the copy for this file and channel has got to.
 *
 * The one place that turns a row into the three words the rest of the system
 * speaks, so the composer, the publish job and the API route cannot disagree
 * about what "ready" means.
 */
export type CopyProgress =
  | { status: 'none' }
  | { status: 'encoding' }
  | { status: 'ready'; url: string; bytes: number | null; width?: number; height?: number; seconds?: number }
  | { status: 'failed'; reason: string }

export function progressOf(row: EncodeJob | null): CopyProgress {
  if (!row) return { status: 'none' }
  if (row.status === 'failed') return { status: 'failed', reason: row.error ?? 'the encode failed' }
  if (row.status !== 'done') return { status: 'encoding' }
  const url = copyUrlOf(row)
  // done with nowhere to read it from is a configuration problem, not a copy
  if (!url) return { status: 'failed', reason: 'the copy was made but file storage is not configured' }
  return {
    status: 'ready',
    url,
    bytes: row.bytes,
    ...(row.width && row.height ? { width: row.width, height: row.height } : {}),
    ...(row.duration_sec ? { seconds: row.duration_sec } : {}),
  }
}
