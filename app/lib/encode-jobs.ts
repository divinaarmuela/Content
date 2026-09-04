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

/** How many times the encoder may be asked for one copy before we give up. */
export const MAX_ENCODE_ATTEMPTS = 3

/**
 * How long a job may sit before the sweep decides nobody is coming.
 *
 * Ninety minutes is longer than the encoder's own ceilings put together
 * (10 minutes to download, 45 to encode, 20 to upload) plus a queue behind it,
 * so a row this old is not slow — it is lost.
 *
 * ── The clock runs from `created_at`, not from the last touch ──
 *
 * The windows are a LADDER against the moment the copy was first asked for:
 * 90 minutes for the first ask, 180 for the second, 270 for the third. So the
 * whole life of a copy that never reports is bounded at 270 minutes — four and
 * a half hours from ask to the plain sentence a person can act on — rather
 * than the sum of three growing gaps.
 *
 * Measuring from `updated_at` instead compounded them: each re-ask reset the
 * clock AND lengthened the next window, so a fresh row went untouched for
 * three hours and the give-up took thirteen and a half. The client's post
 * would have been a day late before anything said why.
 *
 * Each rung still gives an in-flight encode at least 90 minutes of grace,
 * which is more than the encoder's own ceilings put together.
 */
export const STALE_AFTER_MINUTES = 90

export function staleBeforeFor(attempts: number, now = Date.now()): string {
  // attempts counts ASKS made, so a fresh row is 1. A legacy row with none
  // reads as the first rung, which is what it was promised.
  const rung = Math.min(Math.max(1, attempts), MAX_ENCODE_ATTEMPTS)
  return new Date(now - STALE_AFTER_MINUTES * rung * 60_000).toISOString()
}

/** What a person is told when a copy simply never finished. */
export const GAVE_UP_MESSAGE =
  'The clean copy did not finish — try again or post a smaller export'

/**
 * Reasons a second attempt could not possibly go any better.
 *
 * Everything else — an R2 PUT that 500s, a download that timed out on a slow
 * morning, a machine that fell over — is a bad five minutes, not a bad file,
 * and burning the clip's only attempt on one meant every future post of that
 * clip to that channel failed permanently until somebody deleted the row by
 * hand. That is the exact scenario the retry ladder was asked for, and it was
 * only ever covering the SILENT failures.
 *
 * These are matched on the sentence, because the sentence is what travels: the
 * encoder reports words, not codes, and the words are the same ones a person
 * reads on the row.
 */
const PERMANENT_FAILURES = [
  'has no video in it',            // the source is not a video at all
  'this clip is hdr',              // no zscale on the machine; a re-ask cannot help
  'is not a file we hold',         // the URL is not ours
  'not on this workspace',         // the source host is refused
  'is not a channel',              // nonsense platform
  'no encoder is configured',      // nothing will ever call back
  'would fit that channel',        // no ladder exists for this clip and channel
  'is not configured',             // storage is not set up; a retry changes nothing
  'not a plain id',                // the job description itself is wrong
  'must be an https URL',
]

/** Is this failure worth asking about again? */
export function encodeFailureIsPermanent(reason: string | null | undefined): boolean {
  const text = String(reason ?? '').toLowerCase()
  if (!text) return false
  // the markers are written lowercase; the text is lowered to match, so a
  // reason that only differs in case is still recognised
  return PERMANENT_FAILURES.some(marker => text.includes(marker.toLowerCase()))
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
  /** the R2 key the copy will be written to — chosen before the claim, so the
   *  row names the object from the moment it exists */
  outputKey: string
  /** 'measured' if the clip's real length shaped the bitrate, else 'fallback' */
  targetSource: 'measured' | 'fallback'
  /** what the channel is posting this AS, so a retry asks for the same copy */
  kind?: string | null
  /** how long the clip runs, when anything measured it — same reason */
  seconds?: number | null
} & EncodeJobOrigin): Promise<{ at: 'claimed' | 'existing'; row: EncodeJob }> {
  const id = encodeJobId(input.sourceUrl, input.platform)
  const now = new Date().toISOString()
  const taken = await table<EncodeJob>('encode_jobs').claim(id, current =>
    current ? null : {
      id,
      source_url: input.sourceUrl,
      platform: input.platform,
      kind: input.kind ?? null,
      asset_id: input.assetId ?? null,
      version_id: input.versionId ?? null,
      slide_index: input.slideIndex ?? null,
      status: 'queued',
      attempts: 1,
      target_source: input.targetSource,
      output_key: input.outputKey,
      bytes: null,
      width: null,
      height: null,
      // what the bitrate was budgeted FOR, so a retry budgets for it again
      duration_sec: input.seconds ?? null,
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

/**
 * Take a job back that nobody is working on, to ask for it again.
 *
 * `queued` means the encoder was asked and never confirmed — the response was
 * lost, or the machine was busy. The row is NOT deleted and its key is NOT
 * changed: whoever wins this claim re-signs the SAME key, so the row can
 * never end up naming an object the copy was not written to.
 *
 * The claim is what makes this safe to call from two places at once — the
 * step's own retry and the 15-minute sweep — and the `olderThanMs` grace is
 * what stops it racing the caller that created the row seconds ago.
 */
export async function reclaimEncodeJob(
  id: string,
  opts: { olderThanMs: number; now?: number; from?: readonly EncodeStatus[] },
): Promise<{ reclaimed: boolean; row: EncodeJob | null }> {
  const now = opts.now ?? Date.now()
  const before = new Date(now - opts.olderThanMs).toISOString()
  // `queued` by default: a row a machine is actually working on
  // (`running`) is only ever taken back by the sweep, which asks for it.
  const from = opts.from ?? (['queued'] as const)
  const taken = await table<EncodeJob>('encode_jobs').claim(id, cur => {
    if (!cur || !from.includes(cur.status as EncodeStatus)) return null
    if (cur.updated_at > before) return null                       // still warm
    if ((cur.attempts ?? 0) >= MAX_ENCODE_ATTEMPTS) return null    // out of tries
    return {
      ...cur,
      status: 'queued',
      attempts: (cur.attempts ?? 0) + 1,
      updated_at: new Date(now).toISOString(),
    }
  })
  if (taken.claimed) return { reclaimed: true, row: taken.row }
  return { reclaimed: false, row: taken.current }
}

/**
 * Jobs nobody is ever going to finish.
 *
 * A row left `running` when a machine died, or `queued` when the ask was
 * lost, is the one outcome this whole design says it will not have: the
 * publish job cycles queued → queued → queued every ten minutes for ever and
 * nothing anywhere says "failed". The sweep is what makes that impossible.
 */
export async function staleEncodeJobs(now = Date.now()): Promise<EncodeJob[]> {
  const live: EncodeStatus[] = ['queued', 'running']
  return table<EncodeJob>('encode_jobs').list({
    where: r => {
      if (!live.includes(r.status as EncodeStatus)) return false
      // A queued row that already CARRIES a reason is one the encoder reported
      // on: nobody is working on it, so there is nothing to wait for. It is
      // asked again — or given up on — at the very next sweep.
      if (r.status === 'queued' && r.error) return true
      // `<=` so a row that is exactly on its rung is taken THIS sweep rather
      // than fifteen minutes later — the windows are the promise, not a floor
      return r.created_at <= staleBeforeFor(r.attempts ?? 0, now)
    },
    limit: 50,
  }).catch(() => [])
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
 * The job is over — or is going to be asked for again.
 *
 * Only a job that is still queued or running can be settled, so a duplicate
 * callback (the encoder retries its report) lands on a row that is already
 * done and changes nothing — `settled: false` says exactly that, and is not
 * an error.
 *
 * ── A REPORTED failure is retried too ──
 *
 * A copy that says "the R2 PUT returned 500" or "the source download timed
 * out" used to be as terminal as one that said "this file has no video in
 * it": the first `ok: false` moved the row to `failed` for good, and every
 * future post of that clip to that channel failed permanently until somebody
 * deleted the row in the database console. That is the exact scenario the
 * retry ladder exists for, and it was only ever covering failures the encoder
 * never reported at all.
 *
 * So a retryable reason goes back to `queued` with the attempt spent and the
 * reason recorded, and the next sweep asks again — with the SAME key, so the
 * row can never name an object the bytes did not go to. Only a reason a
 * second attempt could not improve on (see `PERMANENT_FAILURES`), or the last
 * attempt, settles `failed`.
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
  /** override the sentence-based judgement, when the caller knows better */
  permanent?: boolean
}): Promise<{ settled: boolean; row: EncodeJob | null; retrying: boolean }> {
  const live: EncodeStatus[] = ['queued', 'running']
  let retrying = false
  const moved = await table<EncodeJob>('encode_jobs').claim(input.id, cur => {
    if (!cur || !live.includes(cur.status as EncodeStatus)) return null

    const measured = {
      bytes: input.bytes ?? cur.bytes,
      width: input.width ?? cur.width,
      height: input.height ?? cur.height,
      duration_sec: input.durationSec ?? cur.duration_sec,
      video_kbps: input.videoKbps ?? cur.video_kbps,
      updated_at: new Date().toISOString(),
    }

    if (input.ok) {
      retrying = false
      return {
        ...cur, ...measured,
        status: 'done',
        output_key: input.outputKey ?? cur.output_key,
        error: null,
      }
    }

    const reason = input.error ?? 'the encode failed'
    const permanent = input.permanent ?? encodeFailureIsPermanent(reason)
    const attempts = cur.attempts ?? 1
    const canTryAgain = !permanent && attempts < MAX_ENCODE_ATTEMPTS
    retrying = canTryAgain
    return {
      ...cur, ...measured,
      // Back to queued with the reason kept, so the row says what went wrong
      // while it waits for the sweep to ask again. `attempts` is NOT touched
      // here: it counts asks MADE, and the next ask is what spends one
      // (`reclaimEncodeJob`). Bumping in both places would burn two tries per
      // failure and give a clip one real retry instead of two.
      status: canTryAgain ? 'queued' : 'failed',
      error: reason,
    }
  })
  if (moved.claimed) return { settled: true, row: moved.row, retrying }
  return { settled: false, row: moved.current, retrying: false }
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
  // a queued row may be carrying the reason its last attempt went wrong — it
  // is still being worked on, so the person waiting is told "encoding", not
  // handed an error about an attempt the system has already moved past
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
