import 'server-only'
import { table } from '@/lib/db'
import type { EncodeJob } from '@/lib/db-types'
import { claimEncodeJob, markEncodeRunning, settleEncodeJob } from './encode-jobs'
import { callbackUrl, requestEncode } from './encoder'
import { encodeTargetFor } from './media-fit-core'
import { isPlatform, type PostKind } from './publish-core'
import { signUpload } from './storage'

/**
 * Ask the encoder for one copy, and leave the row saying so.
 *
 * The whole of the `media/encode` job's body, kept here rather than inside
 * the Inngest function so it can be called directly — by a test, and by
 * anything that ever wants to make a copy without an event in between.
 *
 * The order matters and is not negotiable:
 *
 *   1. presign the upload   — cheap, and the key has to be on the row before
 *                             the encoder can be told where to put the file
 *   2. CLAIM the row        — exactly one caller leaves here owning the job
 *   3. ask the encoder      — only the winner does this
 *
 * Claiming before asking is what stops two events for the same copy becoming
 * two encodes (CLAUDE.md trap 11: never check then write). A presigned URL
 * that the loser then throws away costs nothing — no bytes were moved.
 */

/** Longer than the encoder's own ceilings: 10 minutes to download, 45 to
 *  encode, then the PUT. A URL that expired mid-job would lose the whole
 *  encode with nothing to show for the CPU. */
export const UPLOAD_URL_SECONDS = 6 * 60 * 60

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
  | { at: 'asked'; jobId: string; maxrateKbps: number }
  | { at: 'existing'; jobId: string; status: string }
  | { at: 'refused'; reason: string }

export async function runEncodeRequest(input: EncodeRunInput): Promise<EncodeRunResult> {
  const { sourceUrl } = input
  if (!/^https:\/\//i.test(sourceUrl)) return { at: 'refused', reason: 'that is not a file we hold' }
  if (!isPlatform(input.platform)) return { at: 'refused', reason: `${input.platform} is not a channel` }
  const platform = input.platform

  const target = encodeTargetFor(platform, (input.kind ?? undefined) as PostKind | undefined, input.seconds ?? undefined)
  if (!target) return { at: 'refused', reason: 'no copy of this clip would fit that channel' }

  // 1. where the finished copy will go. Signed for `video/mp4`, which the
  //    encoder must PUT with exactly — R2 rejects anything else as a
  //    signature mismatch.
  let upload: { signedUrl: string; key: string }
  try {
    upload = await signUpload(`copy-${platform}.mp4`, 'video/mp4', { expiresIn: UPLOAD_URL_SECONDS })
  } catch (e) {
    return { at: 'refused', reason: e instanceof Error ? e.message : 'file storage is not configured' }
  }

  // 2. the claim
  const claimed = await claimEncodeJob({
    sourceUrl,
    platform,
    assetId: input.assetId ?? null,
    versionId: input.versionId ?? null,
    slideIndex: input.slideIndex ?? null,
  })
  if (claimed.at === 'existing') {
    return { at: 'existing', jobId: claimed.row.id, status: String(claimed.row.status) }
  }

  const jobId = claimed.row.id
  // the key belongs to the row from here on: the callback carries no key, so
  // this is the only record of where the copy was put
  await table<EncodeJob>('encode_jobs').update(jobId, { output_key: upload.key })

  // 3. the ask
  const asked = await requestEncode({
    jobId,
    sourceUrl,
    target,
    uploadUrl: upload.signedUrl,
    callbackUrl: callbackUrl(),
  })

  if (!asked.accepted) {
    if (asked.busy) {
      /**
       * The machine is busy or unreachable, which is a "later", not a "no".
       *
       * The row is put BACK so a retry can claim it again, and then this
       * throws so Inngest retries with backoff. Leaving the row queued and
       * returning quietly would strand it: nothing else ever looks at a
       * queued encode job.
       */
      await table<EncodeJob>('encode_jobs').remove(jobId).catch(() => {})
      throw new Error(asked.reason)
    }
    await settleEncodeJob({ id: jobId, ok: false, error: asked.reason })
    return { at: 'refused', reason: asked.reason }
  }

  if (asked.stub) {
    // No encoder configured, so nothing will ever call back. Say so on the
    // row rather than leaving it queued forever with nobody working on it.
    await settleEncodeJob({
      id: jobId, ok: false,
      error: 'no encoder is configured on this workspace',
    })
    return { at: 'refused', reason: 'no encoder is configured on this workspace' }
  }

  await markEncodeRunning(jobId)
  return { at: 'asked', jobId, maxrateKbps: target.maxrateKbps }
}
