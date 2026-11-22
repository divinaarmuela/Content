import { stat } from 'node:fs/promises'

/**
 * THE CLIP'S OWN POSTER AND ITS SCRUB COPY (the owner, 22 Nov 2026: "how to get frames with good quality regardless
 * of size and file format … I need exact frames, so when it is hovered it is the actual hover process").
 *
 * A tile in the dashboard shows a still of its clip, and under the pointer it shows the clip AT THAT MOMENT. Those
 * came only from Cloudflare Stream, which turns the heaviest masters away, so a card of ProRes exports was a card of
 * blank tiles. This machine already holds every clip it converts, so it makes both itself:
 *
 *   the poster   one sharp picture, a moment in
 *   the scrub    a small silent copy of the WHOLE clip, cut so that a browser can jump to any frame at once
 *
 * A first try cut thirty fixed pictures; the owner's word was that a slideshow is not scrubbing. Measured the same
 * day in Chrome on a 15-second stinger, with the pointer sweeping across: the ordinary copy took about 50 ms a jump
 * (up to 160), a copy with a keyframe every six frames took 6 ms (never more than 20). A screen redraws every 16 ms,
 * so the second keeps up with the hand and the first does not. That is this file.
 *
 * Both are cut from the COPY, never the master: the copy is already in ordinary colour (an HDR master cut directly
 * comes out washed) and it is small, so this adds a second or two, not minutes.
 *
 * Nothing here can fail a job. A copy with no pictures is a working copy with a plain tile.
 *
 * This file is the pure half: what is asked for, and what ffmpeg is told. The running is in encode.ts.
 */

/** The short side of the poster and the scrub copy. Sharp on a tile at twice the screen's density. */
export const STILL_SHORT_SIDE = 720
/** A keyframe this often. Six frames is the measured sweet spot: 6 ms a jump at about a third of the bytes of one. */
export const SCRUB_KEYFRAME_EVERY = 6
/**
 * The most frames a scrub copy holds. Under this, EVERY frame of the clip is in it (48 seconds at 25 a second);
 * a longer clip is thinned evenly to it, so the file a tile loads on hover stays near 10 MB whatever the length.
 */
export const SCRUB_MAX_FRAMES = 1200

export type StillsAsk = {
  /** a presigned PUT for the poster (image/jpeg) */
  posterUrl: string
  /** a presigned PUT for the scrub copy (video/mp4) */
  scrubUrl: string
}

/** Never larger than the copy, and the SHORT side is the one that is fixed: a vertical clip is not a sliver. */
export const STILL_SCALE =
  `scale='if(gt(iw,ih),-2,min(${STILL_SHORT_SIDE},iw))':'if(gt(iw,ih),min(${STILL_SHORT_SIDE},ih),-2)'`

/** The poster is taken a moment in: frame zero of a camera clip is very often black or a clapper. */
export function posterSecond(durationSec: number): number {
  if (!(durationSec > 0)) return 0
  return Math.min(1, durationSec / 2)
}

export function posterArgs(input: string, output: string, durationSec: number): string[] {
  return [
    '-hide_banner', '-y', '-ss', posterSecond(durationSec).toFixed(3), '-i', input,
    '-frames:v', '1', '-vf', STILL_SCALE, '-q:v', '2', output,
  ]
}

/**
 * How many frames a second the scrub copy runs at: the clip's own, unless that would be more than SCRUB_MAX_FRAMES
 * in all. null = leave the rate alone.
 */
export function scrubFps(durationSec: number, sourceFps: number | null | undefined): number | null {
  const fps = Number(sourceFps)
  if (!(durationSec > 0)) return null
  const own = fps > 0 ? fps : 30
  if (durationSec * own <= SCRUB_MAX_FRAMES) return null
  return Math.max(1, SCRUB_MAX_FRAMES / durationSec)
}

/**
 * The scrub copy: silent, the same length as the clip (so a moment in one is the same moment in the other), a
 * keyframe every six frames, and its index at the front so the first byte range is enough to start.
 */
export function scrubArgs(input: string, output: string, durationSec: number, sourceFps?: number | null): string[] {
  const thin = scrubFps(durationSec, sourceFps)
  const vf = thin ? `fps=${thin.toFixed(4)},${STILL_SCALE}` : STILL_SCALE
  const g = String(SCRUB_KEYFRAME_EVERY)
  return [
    '-hide_banner', '-y', '-i', input, '-an',
    '-vf', vf,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24',
    '-g', g, '-keyint_min', g, '-sc_threshold', '0',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output,
  ]
}

/** Reading the ask off a job description, refusing anything that is not one. */
export function parseStills(raw: unknown): StillsAsk | null | { problem: string } {
  if (raw === undefined || raw === null) return null
  const r = raw as Record<string, unknown>
  const https = (v: unknown): string | null => {
    if (typeof v !== 'string' || !v) return null
    try { const u = new URL(v); return u.protocol === 'https:' ? u.toString() : null } catch { return null }
  }
  const posterUrl = https(r.posterUrl)
  if (!posterUrl) return { problem: 'stills.posterUrl must be an https URL' }
  const scrubUrl = https(r.scrubUrl)
  if (!scrubUrl) return { problem: 'stills.scrubUrl must be an https URL' }
  return { posterUrl, scrubUrl }
}

/** Is this file really there, and not empty? */
export async function fileBytes(path: string): Promise<number> {
  try { return (await stat(path)).size } catch { return 0 }
}
