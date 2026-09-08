import { channelsNeedingCopy } from './shrink-core'
import { encodeTargetFor, type AssetProbe } from './media-fit-core'
import type { MediaItem, Platform, PostKind } from './publish-core'

/**
 * WHICH COPIES TO ASK FOR THE MOMENT THE MEDIA IS ATTACHED.
 *
 * ── The problem this exists for ──
 *
 * A publish-grade copy of an oversized video used to be asked for when the
 * post was DUE: the job reached `awaitCleanCopies`, found no copy, sent the
 * `media/encode` event and went back to the queue to wait. A 700 MB video
 * scheduled for October therefore started encoding in October, and the post
 * went out half an hour after the time somebody had chosen. On the live
 * encoder a 500 MB 1080p source takes tens of minutes.
 *
 * So the ask moves to the moment the media is attached to the post — weeks
 * earlier, while nobody is waiting. Nothing else changes: one encode per file
 * and channel (the claim inside the job sees to that), and `awaitCleanCopies`
 * still runs at publish time as the safety net for a copy that was never
 * asked for or that failed.
 *
 * ── Why it is the same rule, not a similar one ──
 *
 * This answers the SAME question the publish path answers, with the SAME two
 * rules in the same order — `channelsNeedingCopy` (is the shared video too big
 * for this channel, by the platform's limit or by what the provider can
 * actually move) and then `encodeTargetFor` (is a copy worth making at all).
 * A second, nearly-identical rule living here would be the bug: the ahead-of-
 * time ask would prepare a copy the publish path did not want, or miss one it
 * did, and the second case is the one that puts a post out late.
 *
 * Pure by design, so both halves of that claim are testable without a
 * database, an encoder or a clock.
 */

/** One copy to ask the encoder for: exactly the `media/encode` payload. */
export type CopyAsk = {
  sourceUrl: string
  platform: Platform
  /** what the channel is posting this AS, when the composer said */
  kind: PostKind | null
  /** the clip's own length, when anything measured it */
  seconds: number | null
}

/**
 * Every copy this post will need, worked out from what is on it now.
 *
 * Empty is the ordinary answer: a post whose video already fits every channel
 * it is going to asks for nothing, and neither does one with no video, a
 * carousel (a set of slides is not one file to shrink), a channel that
 * already carries its own file, or a video whose size nobody knows yet.
 *
 * `encodeTargetFor` answering null means no copy is worth making for that
 * channel — it has no video size limit to fit inside, or the budget will not
 * stretch past the player file we already have. The publish path treats that
 * as a failure a person has to act on; here it is simply nothing to ask for,
 * because a copy that cannot be made is not made any sooner by asking early.
 */
export function copiesToPrepare(input: {
  probes: AssetProbe[]
  platforms: Platform[]
  kinds?: Partial<Record<Platform, PostKind>>
  own?: Partial<Record<Platform, MediaItem[]>>
}): CopyAsk[] {
  const needing = channelsNeedingCopy(input)
  if (needing.length === 0) return []

  // `channelsNeedingCopy` has already established there is exactly one probe
  // and that it is a video with a known size
  const video = input.probes[0]
  const seconds = typeof video.seconds === 'number' && video.seconds > 0 ? video.seconds : null

  const out: CopyAsk[] = []
  const asked = new Set<Platform>()
  for (const platform of needing) {
    // two Instagram accounts on one post are two channels and ONE copy
    if (asked.has(platform)) continue
    asked.add(platform)
    const kind = input.kinds?.[platform]
    if (!encodeTargetFor(platform, kind, seconds ?? undefined)) continue
    out.push({ sourceUrl: video.url, platform, kind: kind ?? null, seconds })
  }
  return out
}
