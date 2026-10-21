import { describe, expect, it } from 'vitest'
import { compareProbes, comparisonWords, parseDuration, parseProbeLog, soundAlike, type ProbeSample } from '../app/lib/scan-measure-core'
import { signalAnswer, signalScore } from '../app/lib/drive-scan-core'

const LOG = `  Duration: 00:00:56.20, start: 0.000000, bitrate: 41306 kb/s
  Stream #0:0[0x1](eng): Video: h264 (Main) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 2160x3840, 39620 kb/s
[Parsed_metadata_2 @ 0] lavfi.signalstats.YMIN=16
[Parsed_metadata_2 @ 0] lavfi.signalstats.YMAX=235
[Parsed_metadata_2 @ 0] lavfi.signalstats.YAVG=101.5
[Parsed_metadata_2 @ 0] lavfi.signalstats.SATAVG=12.7381
[Parsed_ametadata @ 0] lavfi.astats.Overall.RMS_level=-23.4
[Parsed_ametadata @ 0] lavfi.astats.Overall.RMS_level=-inf
[Parsed_ametadata @ 0] lavfi.astats.Overall.RMS_level=-19.0`

describe('reading what ffmpeg said (a real log shape, 21 Oct 2026)', () => {
  it('the length and frame size', () => {
    expect(parseDuration(LOG)).toEqual({ durationMs: 56_200, width: 2160, height: 3840 })
  })
  it('the colour readings and the loudness every 100 ms', () => {
    expect(parseProbeLog(LOG)).toEqual({ yavg: 101.5, satavg: 12.7381, ymin: 16, ymax: 235, rms: [-23.4, -120, -19] })
  })
})

const wave = (shift = 0) => Array.from({ length: 20 }, (_, i) => -30 + 10 * Math.sin(i / 2 + shift))
const sample = (pct: number, o: Partial<ProbeSample> = {}): ProbeSample => ({ at_pct: pct, at_s: pct * 60, yavg: 100, satavg: 20, ymin: 30, ymax: 200, rms: wave(pct), ...o })
const probe = (o: Partial<ProbeSample> = {}, durationMs = 60_000) => ({ durationMs, samples: [0.1, 0.35, 0.6, 0.85].map(p => sample(p, o)) })

describe('the same edit is known by its sound; a grade by its colour', () => {
  it('the same sound is alike, a different one is not, silence says nothing', () => {
    expect(soundAlike(wave(), wave())).toBeCloseTo(1)
    expect(soundAlike(wave(), wave(3))!).toBeLessThan(0.5)
    expect(soundAlike(Array(20).fill(-120), Array(20).fill(-120))).toBeNull()
  })
  it('graded: same length, same sound, more contrast and saturation', () => {
    const c = compareProbes(probe({ satavg: 38, ymin: 8, ymax: 240 }), probe())
    expect(c.lengthGapMs).toBe(0)
    expect(c.sound).toBeCloseTo(1)
    expect(c.colourShift!).toBeGreaterThan(6)
    expect(c.punchier).toBe(true)
    expect(comparisonWords(c)).toEqual(['same length', 'same sound at the same moments', 'colour changed (more contrast and saturation)'])
    expect(signalAnswer({ asset: 'A', s: c })).toMatchObject({ match: 'A', same_edit: true, colour_changed: true })
  })
  it('a plain copy: same everything, colour unmoved', () => {
    const c = compareProbes(probe(), probe())
    expect(signalAnswer({ asset: 'A', s: c })).toMatchObject({ match: 'A', same_edit: true, colour_changed: false })
  })
  it('a re-cut: shorter, the sound only partly alike', () => {
    const recut = { durationMs: 45_000, samples: [0.1, 0.35, 0.6, 0.85].map((p, i) => sample(p, { rms: i < 2 ? wave(p) : wave(p + 3) })) }
    const c = compareProbes(recut, probe())
    expect(signalAnswer({ asset: 'A', s: c })).toMatchObject({ match: 'A', same_edit: false })
  })
  it('a different video: nothing alike → new', () => {
    const other = { durationMs: 20_000, samples: [0.1, 0.35, 0.6, 0.85].map(p => sample(p, { rms: wave(p + 3) })) }
    expect(signalAnswer({ asset: 'A', s: compareProbes(other, probe()) }).match).toBe('new')
    expect(signalAnswer(null).match).toBe('new')
  })
  it('the closest video on the measures ranks first', () => {
    const same = compareProbes(probe(), probe()), other = compareProbes({ durationMs: 20_000, samples: probe({ rms: wave(3) }).samples }, probe())
    expect(signalScore(same)).toBeGreaterThan(signalScore(other))
  })
})

describe('a silent video', () => {
  it('has no sound to compare, and does not break the comparison', () => {
    expect(soundAlike(undefined, [1, 2, 3, 4, 5, 6])).toBeNull()
    const silent = { durationMs: 10_000, samples: [{ at_pct: 0.1, at_s: 1, yavg: 100, satavg: 50, ymin: 16, ymax: 235 } as never] }
    expect(compareProbes(silent, silent)).toMatchObject({ lengthGapMs: 0, sound: null, colourShift: 0 })
  })
})
