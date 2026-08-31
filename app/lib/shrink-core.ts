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

/** Channels whose limit the SHARED video breaks, and that have no file of
 *  their own yet. Only a lone video qualifies: a carousel's slides are not one
 *  file to shrink. */
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
    return limit !== null && video.bytes! > limit.maxMB * MB
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
  | { status: 'encoding'; percent: number | null }
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

/** The one line on the channel's row while this is happening. */
export function copyWords(platformLabel: string, state: CopyState | undefined): string {
  if (!state) return `Making a smaller copy for ${platformLabel}…`
  if (state.status === 'encoding') {
    return state.percent !== null
      ? `Making a smaller copy for ${platformLabel} — ${Math.round(state.percent)}%`
      : `Making a smaller copy for ${platformLabel}…`
  }
  if (state.status === 'failed') return `Could not make a smaller copy for ${platformLabel}: ${state.reason}`
  const size = state.bytes !== null ? `${Math.round(state.bytes / MB)} MB` : '1080p'
  return `${platformLabel} gets a smaller copy (${size}) — the full file goes to the rest`
}
