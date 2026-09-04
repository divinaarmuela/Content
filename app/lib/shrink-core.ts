/**
 * Which channels need a smaller copy of the shared video, and what that copy
 * will be.
 *
 * A 2 GB master is right for YouTube (256 GB), TikTok (4 GB), LinkedIn (5 GB)
 * and Facebook (4 GB) — it goes to those at full quality. Instagram takes
 * 300 MB, and the provider's promise to compress past that did not hold: a
 * 2 GB file was handed to Instagram raw, and Instagram gave up fetching it.
 *
 * So the copy is ours. Every uploaded video already goes through Cloudflare
 * Stream for the portal preview; Stream hands back a 1080p MP4 of the same
 * clip, and that becomes the channel's OWN file — the per-channel media
 * feature, filled in automatically. Pure: this decides; stream.ts fetches.
 */

import type { MediaItem, Platform, PostKind } from './publish-core'
import { sizeLimitFor, type AssetProbe } from './media-fit-core'

const MB = 1024 * 1024

/**
 * The size past which the provider, in practice, does not deliver.
 *
 * LinkedIn says 5 GB, and that is true of the platform. It is not true of the
 * trip through the provider: every 2 GB master sent to LinkedIn today ended in
 * "Publishing timed out during platform API call". So LinkedIn gets the copy
 * past this ceiling, whatever its documented cap.
 *
 * TikTok is NOT on this list, and was for an hour, wrongly. Its 2 GB uploads
 * looked like failures — the provider reports them as `failed` with
 * "TikTok is still processing this upload… do not repost it" — but the
 * 3:26 pm master went live on TikTok 63 minutes after it was scheduled. Slow
 * is not broken, and sending TikTok a 0.85 Mbps copy to avoid a wait was
 * the wrong trade. TikTok and YouTube keep the full file.
 */
export const PRACTICAL_RELAY_MB = 500

/** Channels that have taken a 2 GB master, end to end, today. */
const TAKES_THE_MASTER: readonly Platform[] = ['youtube', 'tiktok']

/** Channels the SHARED video is too big for — by the platform's rule or by
 *  what the provider can actually move — that have no file of their own yet.
 *  Only a lone video qualifies: a carousel's slides are not one file to shrink. */
export function channelsNeedingCopy(input: {
  probes: AssetProbe[]
  platforms: Platform[]
  kinds?: Partial<Record<Platform, PostKind>>
  own?: Partial<Record<Platform, MediaItem[]>>
}): Platform[] {
  if (input.probes.length !== 1 || input.probes[0].type !== 'video') return []
  const video = input.probes[0]
  if (video.bytes === undefined) return []
  return input.platforms.filter(p => {
    if (input.own?.[p]?.length) return false
    const limit = sizeLimitFor(p, 'video', input.kinds?.[p])
    const platformMax = limit?.maxMB ?? Infinity
    const practicalMax = TAKES_THE_MASTER.includes(p) ? Infinity : PRACTICAL_RELAY_MB
    return video.bytes! > Math.min(platformMax, practicalMax) * MB
  })
}

/** What the 1080p copy measures, from the original's shape. "1080p" caps the
 *  SHORTER side: a 4K landscape master becomes 1920 x 1080, a 4K vertical one
 *  1080 x 1920, and a 1080 x 1920 Reel is left exactly as it is. */
export function copyDimensions(
  original: { width?: number; height?: number },
): { width?: number; height?: number } {
  const { width, height } = original
  if (!width || !height) return {}
  const cap = 1080
  const shortest = Math.min(width, height)
  if (shortest <= cap) return { width, height }
  const scale = cap / shortest
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

export type CopyState =
  | { status: 'encoding'; percent: number | null; note?: string }
  | { status: 'ready'; url: string; bytes: number | null; width?: number; height?: number; seconds?: number }
  | { status: 'failed'; reason: string }

/** The probe the check runs on, once the copy exists. */
export function probeForCopy(
  original: AssetProbe, copy: Extract<CopyState, { status: 'ready' }>,
): AssetProbe {
  const dims = copyDimensions({ width: copy.width ?? original.width, height: copy.height ?? original.height })
  return {
    url: copy.url,
    type: 'video',
    mime: 'video/mp4',
    ...(copy.bytes !== null ? { bytes: copy.bytes } : {}),
    ...dims,
    ...(copy.seconds ?? original.seconds ? { seconds: copy.seconds ?? original.seconds } : {}),
  }
}

/**
 * Of the channels waiting for a copy, the one with the least room.
 *
 * ONE copy is made and every waiting channel gets it, so it has to be made
 * for the tightest of them — a file that fits Instagram fits X, but not the
 * other way round. Taking the first of the list instead was taking whichever
 * channel happened to be ticked first, which is not a rule at all.
 *
 * Ties break on the list's own order, so the answer is stable.
 */
export function tightestChannel(
  platforms: Platform[], kinds?: Partial<Record<Platform, PostKind>>,
): Platform | null {
  let best: Platform | null = null
  let bestMB = Infinity
  for (const p of platforms) {
    const mb = sizeLimitFor(p, 'video', kinds?.[p])?.maxMB ?? Infinity
    if (mb < bestMB) { best = p; bestMB = mb }
  }
  return best ?? platforms[0] ?? null
}

/**
 * What a person is told while the encoder is working.
 *
 * Plain, and honest about the wait: a 2 GB master takes minutes, and "…"
 * with no number behind it reads as "stuck" to somebody who has been looking
 * at it for ninety seconds.
 */
export function cleanCopyWords(platformLabel: string): string {
  return `Making a clean copy for ${platformLabel} — usually a few minutes`
}

/** The one line on the channel's row while this is happening. */
export function copyWords(platformLabel: string, state: CopyState | undefined): string {
  if (!state) return `Making a smaller copy for ${platformLabel}…`
  if (state.status === 'encoding') {
    // the encoder says how long it usually takes; Cloudflare says how far
    // through it is. Whichever we were given is what the row shows.
    if (state.note) return state.note
    return state.percent !== null
      ? `Making a smaller copy for ${platformLabel} — ${Math.round(state.percent)}%`
      : `Making a smaller copy for ${platformLabel}…`
  }
  if (state.status === 'failed') return `Could not make a smaller copy for ${platformLabel}: ${state.reason}`
  const size = state.bytes !== null ? `${Math.round(state.bytes / MB)} MB` : '1080p'
  return `${platformLabel} gets a smaller copy (${size}) — the full file goes to the rest`
}

/** The copy, measured: "1080 x 1920 · 14s · 11 MB". What answers "11 MB?". */
export function copyMeasureWords(probe: { width?: number; height?: number; seconds?: number; bytes?: number }): string {
  const parts: string[] = []
  if (probe.width && probe.height) parts.push(`${probe.width} x ${probe.height}`)
  if (probe.seconds !== undefined) parts.push(`${Math.round(probe.seconds)}s`)
  if (probe.bytes !== undefined) parts.push(`${Math.round(probe.bytes / MB)} MB`)
  return parts.join(' · ')
}
