import 'server-only'
import type { EncodeJob } from '@/lib/db-types'
import {
  GAVE_UP_MESSAGE, MAX_ENCODE_ATTEMPTS, claimEncodeJob, markEncodeRunning,
  reclaimEncodeJob, settleEncodeJob, staleEncodeJobs,
} from './encode-jobs'
import { callbackUrl, requestEncode } from './encoder'
import { encodeTargetFor, type EncodeTarget } from './media-fit-core'
import { isPlatform, type Platform, type PostKind } from './publish-core'
import { objectKey, signUploadForKey } from './storage'

/**
 * Ask the encoder for one copy, and leave the row saying so.
 *
 * The whole of the `media/encode` job's body, kept here rather than inside
 * the Inngest function so it can be called directly — by a test, and by
 * anything that ever wants to make a copy without an event in between.
 *
 * The order matters and is not negotiable:
 *
 *   1. choose the R2 key    — a name, no bytes, no network
 *   2. CLAIM the row WITH the key — exactly one caller leaves owning the job,
 *                             and the row names its object from the moment it
 *                             exists
 *   3. presign and ask      — only the winner does this
 *
 * Claiming before asking is what stops two events for the same copy becoming
 * two encodes (CLAUDE.md trap 11: never check then write).
 *
 * ── Why a lost response never changes the key ──
 *
 * `requestEncode` reports `busy` for ANY failure to get an answer, which
 * includes "the encoder accepted the job and then the response was lost". The
 * first version deleted the row on that path; the retry then presigned a NEW
 * key while the first encode — still running — PUT to the OLD one. The row
 * ended up `done` with a key nothing had written, `progressOf` reported
 * `ready`, and the URL 404'd on a client's post.
 *
 * So the row is never deleted. It stays `queued` with its key, and every
 * retry re-signs the SAME key. `output_key` always names the object the bytes
 * went to, whatever happened in between.
 */

/** Longer than the encoder's own ceilings: 10 minutes to download, 45 to
 *  encode, then the PUT. A URL that expired mid-job would lose the whole
 *  encode with nothing to show for the CPU. */
export const UPLOAD_URL_SECONDS = 6 * 60 * 60

/** How warm a `queued` row must be before a retry leaves it alone. Long
 *  enough that the caller which created it seconds ago is still asking. */
export const REASK_GRACE_MS = 60_000

export type EncodeRunInput = {
  sourceUrl: string
  platform: string
  kind?: string | null
  seconds?: number | null
  assetId?: string | null
  versionId?: string | null
  slideIndex?: number | null
}

export type EncodeRunResult =
  | { at: 'asked'; jobId: string; maxrateKbps: number; attempt: number }
  | { at: 'existing'; jobId: string; status: string }
  | { at: 'refused'; reason: string }

/** Hand one job to the encoder, on a row that already exists and is ours. */
async function askEncoder(
  row: EncodeJob, target: EncodeTarget,
): Promise<EncodeRunResult> {
  const jobId = row.id
  const key = row.output_key
  if (!key) {
    await settleEncodeJob({ id: jobId, ok: false, error: 'the copy had nowhere to be written to' })
    return { at: 'refused', reason: 'the copy had nowhere to be written to' }
  }

  let uploadUrl: string
  try {
    // the SAME key, every time — see the note at the top of this file
    uploadUrl = (await signUploadForKey(key, 'video/mp4', { expiresIn: UPLOAD_URL_SECONDS })).signedUrl
  } catch (e) {
    const reason = e instanceof Error ? e.message : 'file storage is not configured'
    await settleEncodeJob({ id: jobId, ok: false, error: reason })
    return { at: 'refused', reason }
  }

  const asked = await requestEncode({
    jobId, sourceUrl: row.source_url, target, uploadUrl, callbackUrl: callbackUrl(),
  })

  if (!asked.accepted) {
    if (asked.busy) {
      /**
       * Busy, unreachable, or an answer that never came back.
       *
       * The row STAYS `queued` with its key. Throwing hands the step to
       * Inngest's backoff, and the 15-minute sweep is the backstop if every
       * one of those is lost too.
       */
      throw new Error(asked.reason)
    }
    await settleEncodeJob({ id: jobId, ok: false, error: asked.reason })
    return { at: 'refused', reason: asked.reason }
  }

  if (asked.stub) {
    // No encoder configured, so nothing will ever call back. Say so on the
    // row rather than leaving it queued for the sweep to discover in an hour.
    await settleEncodeJob({
      id: jobId, ok: false, error: 'no encoder is configured on this workspace',
    })
    return { at: 'refused', reason: 'no encoder is configured on this workspace' }
  }

  await markEncodeRunning(jobId)
  return { at: 'asked', jobId, maxrateKbps: target.maxrateKbps, attempt: row.attempts ?? 1 }
}

/** The target this row's copy should be made at, or null if none would fit. */
function targetFor(row: EncodeJob, seconds?: number | null): EncodeTarget | null {
  if (!isPlatform(row.platform)) return null
  return encodeTargetFor(row.platform, undefined, seconds ?? undefined)
}

export async function runEncodeRequest(input: EncodeRunInput): Promise<EncodeRunResult> {
  const { sourceUrl } = input
  if (!/^https:\/\//i.test(sourceUrl)) return { at: 'refused', reason: 'that is not a file we hold' }
  if (!isPlatform(input.platform)) return { at: 'refused', reason: `${input.platform} is not a channel` }
  const platform: Platform = input.platform

  const measured = typeof input.seconds === 'number' && input.seconds > 0 ? input.seconds : undefined
  const target = encodeTargetFor(platform, (input.kind ?? undefined) as PostKind | undefined, measured)
  if (!target) return { at: 'refused', reason: 'no copy of this clip would fit that channel' }

  // 1 + 2. the key, then the claim that carries it
  const claimed = await claimEncodeJob({
    sourceUrl,
    platform,
    outputKey: objectKey(`copy-${platform}.mp4`),
    targetSource: measured ? 'measured' : 'fallback',
    assetId: input.assetId ?? null,
    versionId: input.versionId ?? null,
    slideIndex: input.slideIndex ?? null,
  })

  if (claimed.at === 'existing') {
    const row = claimed.row
    // A `queued` row that has gone cold means an earlier ask was lost. Take
    // it back — atomically, so the step's retry and the sweep cannot both —
    // and ask again with the SAME key.
    if (row.status === 'queued') {
      const retaken = await reclaimEncodeJob(row.id, { olderThanMs: REASK_GRACE_MS })
      if (retaken.reclaimed && retaken.row) return askEncoder(retaken.row, target)
    }
    return { at: 'existing', jobId: row.id, status: String(row.status) }
  }

  // 3. only the winner asks
  return askEncoder(claimed.row, target)
}

export type EncodeSweepResult = { retried: number; gaveUp: number }

/**
 * Settle every copy nobody is ever going to finish.
 *
 * Without this, a machine killed mid-encode or a callback lost across a
 * deploy leaves the row `running` for ever: the publish job cycles
 * queued → queued → queued every ten minutes, the client's post never goes
 * out, and no row anywhere says "failed". That is the one outcome the whole
 * design says it will not have, so this is not housekeeping — it is the
 * guarantee.
 *
 * Three tries with a growing wait (90 minutes, then 180, then 270), because a
 * transient blip should not permanently poison every future post of that clip
 * — and then a plain sentence, so the waiting publish job takes the failed
 * branch it already has and says something a person can act on.
 */
export async function sweepStaleEncodes(now = Date.now()): Promise<EncodeSweepResult> {
  const rows = await staleEncodeJobs(now)
  let retried = 0
  let gaveUp = 0

  for (const row of rows) {
    const attempts = row.attempts ?? 0
    if (attempts < MAX_ENCODE_ATTEMPTS) {
      // `running` is included here and nowhere else: a row a machine is
      // genuinely working on is only ever taken back once it is this stale,
      // which is longer than every one of the encoder's own timeouts.
      const retaken = await reclaimEncodeJob(row.id, {
        olderThanMs: 0, now, from: ['queued', 'running'],
      })
      if (!retaken.reclaimed || !retaken.row) continue     // somebody else has it
      const target = targetFor(retaken.row, retaken.row.duration_sec)
      if (!target) {
        await settleEncodeJob({ id: row.id, ok: false, error: GAVE_UP_MESSAGE })
        gaveUp++
        continue
      }
      try {
        await askEncoder(retaken.row, target)
        retried++
      } catch (e) {
        // still unreachable — the row stays queued with its key and the next
        // sweep, ninety minutes further on, tries again or gives up
        console.error(`[encode sweep] ${row.id} could not be re-asked:`, e instanceof Error ? e.message : e)
      }
      continue
    }

    const settled = await settleEncodeJob({ id: row.id, ok: false, error: GAVE_UP_MESSAGE })
    if (settled.settled) {
      gaveUp++
      console.error(`[encode sweep] gave up on ${row.id} after ${attempts} attempts`)
    }
  }

  return { retried, gaveUp }
}
