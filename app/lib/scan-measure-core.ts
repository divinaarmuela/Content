/**
 * THE MEASURE OF A VIDEO AND THE COMPARISON OF TWO — pure (scan-measure.ts runs ffmpeg; this reads what it said).
 *
 * What the research says to compare (21 Oct 2026 — Avid Matchbox, HAL CUT-IT, Resolve's timeline compare, duplicate
 * finders): an EDIT is known by its sound and its timing — a grade never touches the sound; a GRADE is known by its
 * colour — contrast, saturation, black and white points move while the shots stay put. The name of the file is never
 * evidence (the owner: "different names of file only will not be enough").
 */

/** the four moments looked at: away from the very start and end, where titles and black frames sit */
export const PROBE_POINTS = [0.1, 0.35, 0.6, 0.85] as const

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
export function soundAlike(a: readonly number[], b: readonly number[]): number | null {
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
}

const avg = (v: number[]) => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : null)

export function compareProbes(
  a: { durationMs: number | null; samples: readonly ProbeSample[] },
  b: { durationMs: number | null; samples: readonly ProbeSample[] },
): Comparison {
  const pairs = a.samples.map(s => [s, b.samples.find(t => Math.abs(t.at_pct - s.at_pct) < 0.01)] as const).filter((p): p is readonly [ProbeSample, ProbeSample] => !!p[1])
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
  }
}

/** the signals in words, for the card and for the AI */
export function comparisonWords(c: Comparison): string[] {
  const out: string[] = []
  if (c.lengthGapMs !== null) out.push(c.lengthGapMs <= 100 ? 'same length' : `length differs by ${(c.lengthGapMs / 1000).toFixed(1)}s`)
  if (c.sound !== null) out.push(c.sound >= 0.8 ? 'same sound at the same moments' : c.sound >= 0.5 ? 'similar sound' : 'different sound')
  if (c.colourShift !== null) out.push(c.colourShift >= 6 ? `colour changed${c.punchier ? ' (more contrast and saturation)' : ''}` : 'colour unchanged')
  return out
}
