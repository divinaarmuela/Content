/**
 * THE MEASURE OF A VIDEO AND THE COMPARISON OF TWO — pure (scan-measure.ts runs ffmpeg; this reads what it said).
 *
 * What the research says to compare (21 Oct 2026 — Avid Matchbox, HAL CUT-IT, Resolve's timeline compare, duplicate
 * finders): an EDIT is known by its sound and its timing — a grade never touches the sound; a GRADE is known by its
 * colour — contrast, saturation, black and white points move while the shots stay put. The name of the file is never
 * evidence (the owner: "different names of file only will not be enough").
 */

/** the four moments looked at: away from the very start and end, where titles and black frames sit */
/**
 * TWELVE MOMENTS, evenly from 4% to 96% (the owner, 21 Oct 2026: four frames could not tell a re-edit from another
 * video of the same shoot — the AI needs the whole run of shots, and their on-screen text, to judge)
 */
export const PROBE_POINTS = Array.from({ length: 12 }, (_, i) => Math.round((0.04 + i * (0.92 / 11)) * 1000) / 1000)
/** the measures cached under this version; a new set of moments is a new version, measured afresh */
export const PROBE_VERSION = 'p12'

export type ProbeSample = {
  at_pct: number
  at_s: number
  /** mean brightness, mean saturation, the darkest and brightest levels (0–255) of the frame */
  yavg: number | null
  satavg: number | null
  ymin: number | null
  ymax: number | null
  /** loudness every 100 ms over two seconds, in dB (silence is -120) */
  rms: number[]
  /** the frame's fingerprint: a 64-bit difference hash, 16 hex digits — the same shot gives nearly the same hash */
  hash?: string | null
}

/** a 9×8 greyscale frame (72 bytes, row by row) to its difference hash: each pixel brighter than its right neighbour */
export function dHashOf(gray: ArrayLike<number>): string | null {
  if (!gray || gray.length < 72) return null
  let hex = ''
  for (let row = 0; row < 8; row++) {
    let byte = 0
    for (let col = 0; col < 8; col++) byte = (byte << 1) | (gray[row * 9 + col] > gray[row * 9 + col + 1] ? 1 : 0)
    hex += byte.toString(16).padStart(2, '0')
  }
  return hex
}

export function hamming(a: string, b: string): number {
  let d = 0
  for (let i = 0; i < Math.min(a.length, b.length); i += 2) {
    let x = parseInt(a.slice(i, i + 2), 16) ^ parseInt(b.slice(i, i + 2), 16)
    while (x) { d += x & 1; x >>= 1 }
  }
  return d
}

/**
 * THE SAME PICTURES, anywhere in the video (0–1): the share of one video's frames that have a near-identical frame
 * somewhere in the other. A re-edit keeps its shots wherever they moved to; another video of the same shoot shares
 * the set but rarely the shot (live, 21 Oct 2026: Olimpia_P2C_VF was never shown its own draft, because the sound
 * and length ranked two menu videos above it).
 */
export function pictureAlike(a: readonly (string | null | undefined)[], b: readonly (string | null | undefined)[], near = 10): number | null {
  const x = a.filter((h): h is string => !!h), y = b.filter((h): h is string => !!h)
  if (x.length < 3 || y.length < 3) return null
  return x.filter(h => y.some(k => hamming(h, k) <= near)).length / x.length
}

export function parseDuration(log: string): { durationMs: number | null; width: number | null; height: number | null } {
  const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(log)
  const s = /Stream #\d+:\d+[^\n]*Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/.exec(log)
  return {
    durationMs: d ? Math.round(((Number(d[1]) * 60 + Number(d[2])) * 60 + Number(d[3])) * 1000) : null,
    width: s ? Number(s[1]) : null,
    height: s ? Number(s[2]) : null,
  }
}

const num = (log: string, key: string): number | null => {
  const m = new RegExp(`lavfi\\.signalstats\\.${key}=(-?[\\d.]+)`).exec(log)
  return m ? Number(m[1]) : null
}

export function parseProbeLog(log: string): Omit<ProbeSample, 'at_pct' | 'at_s'> {
  const rms = [...log.matchAll(/lavfi\.astats\.Overall\.RMS_level=(-?inf|-?[\d.]+)/g)]
    .map(m => (/inf/.test(m[1]) ? -120 : Math.max(-120, Number(m[1]))))
  return { yavg: num(log, 'YAVG'), satavg: num(log, 'SATAVG'), ymin: num(log, 'YMIN'), ymax: num(log, 'YMAX'), rms }
}

/** how alike two loudness traces are, 0–1 (Pearson's r, clipped) — the same sound moment for moment is near 1 */
export function soundAlike(a: readonly number[] | null | undefined, b: readonly number[] | null | undefined): number | null {
  // a video with no sound track has no trace — and the database drops an empty list, so it reads back as nothing
  // (live, 21 Oct 2026: 23 of Alia's silent carousels failed on it)
  if (!a || !b) return null
  const n = Math.min(a.length, b.length)
  if (n < 6) return null
  const x = a.slice(0, n), y = b.slice(0, n)
  const quiet = (v: number[]) => v.every(t => t <= -60)
  if (quiet(x) && quiet(y)) return null
  const mx = x.reduce((s, v) => s + v, 0) / n, my = y.reduce((s, v) => s + v, 0) / n
  let num = 0, dx = 0, dy = 0
  for (let i = 0; i < n; i++) { num += (x[i] - mx) * (y[i] - my); dx += (x[i] - mx) ** 2; dy += (y[i] - my) ** 2 }
  if (dx === 0 || dy === 0) {
    // a flat trace: alike only when the levels themselves are close
    const gap = Math.abs(mx - my)
    return gap < 1.5 ? 1 : 0
  }
  return Math.max(0, num / Math.sqrt(dx * dy))
}

export type Comparison = {
  /** |difference| of the two lengths, ms */
  lengthGapMs: number | null
  /** sound alike, averaged over the moments that had sound (0–1) */
  sound: number | null
  /** colour moved: mean |Δ| of saturation, contrast (ymax−ymin) and black point, on 0–255 */
  colourShift: number | null
  /** the new one is punchier (more contrast and saturation) — a grade, not a wash-out */
  punchier: boolean | null
  /** the same pictures anywhere in the other video (0–1) */
  picture?: number | null
}

const avg = (v: number[]) => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : null)

export function compareProbes(
  a: { durationMs: number | null; samples: readonly ProbeSample[] },
  b: { durationMs: number | null; samples: readonly ProbeSample[] },
): Comparison {
  const pairs = (a.samples ?? []).map(s => [s, (b.samples ?? []).find(t => Math.abs(t.at_pct - s.at_pct) < 0.01)] as const).filter((p): p is readonly [ProbeSample, ProbeSample] => !!p[1])
  const sounds = pairs.map(([x, y]) => soundAlike(x.rms, y.rms)).filter((v): v is number => v !== null)
  const shifts: number[] = [], contrastUp: number[] = [], satUp: number[] = []
  for (const [x, y] of pairs) {
    if (x.satavg === null || y.satavg === null || x.ymin === null || y.ymin === null || x.ymax === null || y.ymax === null) continue
    const cx = x.ymax - x.ymin, cy = y.ymax - y.ymin
    shifts.push((Math.abs(x.satavg - y.satavg) + Math.abs(cx - cy) + Math.abs(x.ymin - y.ymin)) / 3)
    contrastUp.push(cx - cy)
    satUp.push(x.satavg - y.satavg)
  }
  const c = avg(contrastUp), s = avg(satUp)
  return {
    lengthGapMs: a.durationMs !== null && b.durationMs !== null ? Math.abs(a.durationMs - b.durationMs) : null,
    sound: avg(sounds),
    colourShift: avg(shifts),
    punchier: c === null || s === null ? null : c + s > 2,
    picture: pictureAlike((a.samples ?? []).map(x => x.hash), (b.samples ?? []).map(x => x.hash)),
  }
}

/** the signals in words, for the card and for the AI */
export function comparisonWords(c: Comparison): string[] {
  const out: string[] = []
  if (c.lengthGapMs !== null) out.push(c.lengthGapMs <= 100 ? 'same length' : `length differs by ${(c.lengthGapMs / 1000).toFixed(1)}s`)
  if (c.picture != null) out.push(c.picture >= 0.6 ? 'the same shots' : c.picture >= 0.3 ? 'some of the same shots' : 'different shots')
  if (c.sound !== null) out.push(c.sound >= 0.8 ? 'same sound at the same moments' : c.sound >= 0.5 ? 'similar sound' : 'different sound')
  // colour only means something between two cuts of the same edit: different shots always differ in colour (the
  // owner, 21 Oct 2026: "Book Concept … colour changed — what does it mean")
  if (c.colourShift !== null && c.lengthGapMs !== null && c.lengthGapMs <= 150) out.push(c.colourShift >= 6 ? `colour changed${c.punchier ? ' (more contrast and saturation)' : ''}` : 'colour unchanged')
  return out
}
