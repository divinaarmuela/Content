/**
 * THE COVER — the pure half.
 *
 * One picture, chosen once in the post window, sent to each network the way
 * that network takes it (read off Zernio's guides, 10 Sep 2026):
 *
 *   Instagram  `instagramThumbnail` — the Reel cover; JPEG/PNG, 1080 x 1920
 *              recommended; wins over `thumbOffset`
 *   Facebook   the same field name on a Reel
 *   TikTok     `video_cover_image_url` — JPG/PNG/WebP up to 20 MB; TikTok
 *              stitches it in as the first frame of the video; wins over
 *              `video_cover_timestamp_ms`
 *   YouTube    `mediaItems[].thumbnail` — JPEG/PNG/GIF up to 2 MB, 1280 x 720
 *              recommended, 640 px wide at least; videos only, never a Short;
 *              only on a phone-verified channel (else skipped, and Zernio
 *              stops trying on that channel for seven days)
 *
 * The window's fields already exist for every one of these
 * (`thumbnailUrl`, `videoCoverImageUrl`); this file only decides which field
 * a picture goes into, what to say about it, and whether a file fits.
 */

import type { ChannelExtras } from './schedule-compose-core'
import { networkName } from './publish-core'

export type CoverRule = {
  /** file extensions the network takes, lower case */
  formats: readonly string[]
  maxMB: number
  /** the one line under the picker for this network */
  note: string
}

export const COVER_RULES: Record<string, CoverRule> = {
  instagram: { formats: ['jpg', 'jpeg', 'png'], maxMB: 8, note: 'Instagram: the Reel cover. Best at 1080 x 1920.' },
  facebook: { formats: ['jpg', 'jpeg', 'png'], maxMB: 8, note: 'Facebook: the Reel cover.' },
  tiktok: { formats: ['jpg', 'jpeg', 'png', 'webp'], maxMB: 20, note: 'TikTok: stitched in as the first frame of the video.' },
  youtube: {
    formats: ['jpg', 'jpeg', 'png', 'gif'], maxMB: 2,
    note: 'YouTube: the thumbnail on a video, never on a Short, and only on a phone-verified channel.',
  },
}

/** Which networks on this post take a cover picture at all. */
export function coverPlatforms(platforms: readonly string[]): string[] {
  return [...new Set(platforms.map(p => String(p).toLowerCase()).filter(p => p in COVER_RULES))]
}

/** The per-channel fields a chosen cover writes for one network — or an
 *  empty patch where the network has no cover field. `null` clears it. */
export function coverPatchFor(platform: string, url: string | null): ChannelExtras {
  const p = String(platform).toLowerCase()
  if (p === 'tiktok') return { videoCoverImageUrl: url ?? undefined }
  if (p === 'instagram' || p === 'facebook' || p === 'youtube') return { thumbnailUrl: url ?? undefined }
  return {}
}

/** The cover this post carries now: a picture chosen in the window on any
 *  channel, else the one the video editor saved, else nothing. */
export function currentCover(
  perChannel: Record<string, ChannelExtras | undefined> | null | undefined,
  accounts: readonly { id: string; platform: string }[],
  editorCover: string | null | undefined,
): { url: string; source: 'window' | 'editor' } | null {
  for (const a of accounts) {
    const x = perChannel?.[a.id]
    const url = String(a.platform).toLowerCase() === 'tiktok' ? x?.videoCoverImageUrl : x?.thumbnailUrl
    if (url?.trim()) return { url: url.trim(), source: 'window' }
  }
  return editorCover?.trim() ? { url: editorCover.trim(), source: 'editor' } : null
}

/** Everything wrong with this file as a cover for these networks — a
 *  sentence per network that would refuse it, none when all take it. */
export function coverProblems(
  file: { name: string; size: number },
  platforms: readonly string[],
): string[] {
  const ext = String(file.name.split('.').pop() ?? '').toLowerCase()
  const mb = file.size / (1024 * 1024)
  const out: string[] = []
  for (const p of coverPlatforms(platforms)) {
    const rule = COVER_RULES[p]
    const name = networkName(p)
    if (ext && !rule.formats.includes(ext)) {
      out.push(`${name} does not take a .${ext} cover — use ${rule.formats.filter(f => f !== 'jpg').map(f => f.toUpperCase()).join(', ')}.`)
    } else if (mb > rule.maxMB) {
      out.push(`${name} takes a cover of up to ${rule.maxMB} MB — this one is ${mb.toFixed(1)} MB.`)
    }
  }
  return out
}

/** Where along the clip the frame strip takes its stills: `n` evenly spaced
 *  moments, never the very first or last frame (those are often black). */
export function coverFrameTimes(durationSec: number, n = 8): number[] {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return []
  const count = Math.max(1, Math.min(n, Math.floor(durationSec) || 1))
  return Array.from({ length: count }, (_, i) => Math.min(durationSec - 0.05, ((i + 0.5) / count) * durationSec))
    .map(t => Math.max(0, Math.round(t * 10) / 10))
}
