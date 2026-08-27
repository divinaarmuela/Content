import { describe, expect, it } from 'vitest'
import {
  MIN_SAMPLE_MS, RATE_ALPHA,
  advanceProgress, etaSeconds, formatEta, formatRate, formatSize, isSettled,
  overallProgress, percent, progressLine, startProgress, statusWords,
} from '../app/lib/upload-progress-core'

const MB = 1024 * 1024

describe('percent', () => {
  it('is a whole number between 0 and 100', () => {
    expect(percent(0, 100)).toBe(0)
    expect(percent(50, 100)).toBe(50)
    expect(percent(100, 100)).toBe(100)
  })
  it('never shows NaN or a full bar for a file of unknown size', () => {
    // a store that reports no length must not read as "finished"
    expect(percent(0, 0)).toBe(0)
    expect(percent(10, 0)).toBe(0)
  })
  it('clamps a total the browser under-reported', () => {
    expect(percent(120, 100)).toBe(100)
    expect(percent(-5, 100)).toBe(0)
  })
})

describe('advanceProgress', () => {
  it('has no opinion about speed from a single sample', () => {
    const s = advanceProgress(startProgress(10 * MB, 0), { loaded: MB, at: 1000 })
    expect(s.loaded).toBe(MB)
    // one sample against the start IS two points, so a rate is available
    expect(s.rateBps).toBeCloseTo(MB, 0)
  })

  it('moves the bar on every event, however close together', () => {
    // progress events can arrive several to the millisecond; the bar must
    // still track them even though the rate cannot be recomputed
    let s = startProgress(10 * MB, 0)
    s = advanceProgress(s, { loaded: 1000, at: 5 })
    s = advanceProgress(s, { loaded: 2000, at: 9 })
    expect(s.loaded).toBe(2000)
    expect(s.rateBps).toBeNull()
  })

  it('refuses to divide by a near-zero interval', () => {
    // the bug this prevents: an enormous rate, then an ETA of zero on a file
    // with 900 MB still to go
    const s = advanceProgress(startProgress(1000 * MB, 0), { loaded: 5 * MB, at: MIN_SAMPLE_MS - 1 })
    expect(s.rateBps).toBeNull()
    expect(s.etaSec).toBeNull()
  })

  it('smooths a spike instead of believing it', () => {
    let s = startProgress(100 * MB, 0)
    s = advanceProgress(s, { loaded: 1 * MB, at: 1000 })   // 1 MB/s established
    const steady = s.rateBps!
    s = advanceProgress(s, { loaded: 11 * MB, at: 2000 })  // a 10 MB/s burst
    // believed only RATE_ALPHA of the way towards the spike
    expect(s.rateBps).toBeCloseTo(steady + RATE_ALPHA * (10 * MB - steady), 0)
    expect(s.rateBps).toBeLessThan(10 * MB)
  })

  it('ignores a sample that goes backwards rather than showing a negative speed', () => {
    let s = startProgress(10 * MB, 0)
    s = advanceProgress(s, { loaded: 5 * MB, at: 1000 })
    const before = s.rateBps
    s = advanceProgress(s, { loaded: 4 * MB, at: 2000 })
    expect(s.loaded).toBe(4 * MB)      // the bar tells the truth
    expect(s.rateBps).toBe(before)     // the speed does not become negative
  })

  it('takes a total the browser reports over the one it was given', () => {
    const s = advanceProgress(startProgress(0, 0), { loaded: MB, total: 4 * MB, at: 1000 })
    expect(s.total).toBe(4 * MB)
  })
})

describe('etaSeconds', () => {
  it('is the bytes left over the rate', () => {
    expect(etaSeconds(2 * MB, 10 * MB, MB)).toBe(8)
  })
  it('says nothing rather than something wrong', () => {
    expect(etaSeconds(0, 10, null)).toBeNull()
    expect(etaSeconds(0, 10, 0)).toBeNull()
    expect(etaSeconds(0, 0, 100)).toBeNull()
  })
  it('is zero, not negative, once the total is passed', () => {
    expect(etaSeconds(11, 10, 100)).toBe(0)
  })
})

describe('the words', () => {
  it('formats a rate as a size per second', () => {
    expect(formatRate(12 * MB)).toBe('12 MB/s')
    expect(formatRate(500 * 1024)).toBe('500 KB/s')
  })
  it('says nothing at all rather than "0 B/s"', () => {
    expect(formatRate(0)).toBeNull()
    expect(formatRate(null)).toBeNull()
  })

  it('rounds the ETA coarsely', () => {
    expect(formatEta(40)).toBe('40 s left')
    expect(formatEta(125)).toBe('2 min left')
    expect(formatEta(3600)).toBe('1 h left')
    expect(formatEta(4320)).toBe('1 h 12 min left')
  })
  it('stops counting down at the end', () => {
    expect(formatEta(0.5)).toBe('almost done')
    expect(formatEta(null)).toBeNull()
    expect(formatEta(Infinity)).toBeNull()
  })

  it('is one line of whichever halves are known', () => {
    expect(progressLine({ rateBps: 12 * MB, etaSec: 40, status: 'uploading' }))
      .toBe('12 MB/s · 40 s left')
    expect(progressLine({ rateBps: 12 * MB, etaSec: null, status: 'uploading' }))
      .toBe('12 MB/s')
    expect(progressLine({ rateBps: null, etaSec: null, status: 'uploading' })).toBeNull()
  })
  it('says nothing once the bytes have stopped moving', () => {
    // a speed beside a finished file is a number about the past
    expect(progressLine({ rateBps: 12 * MB, etaSec: 40, status: 'processing' })).toBeNull()
    expect(progressLine({ rateBps: 12 * MB, etaSec: 40, status: 'done' })).toBeNull()
  })

  it('sizes a file the way the rest of the app does', () => {
    expect(formatSize(184 * MB)).toBe('184 MB')
    expect(formatSize(0)).toBeNull()
  })
})

describe('statusWords', () => {
  it('distinguishes the bytes landing from the record of them', () => {
    // a tick between the PUT and the PATCH is a promise a refresh would break
    expect(statusWords('queued')).toBe('Waiting')
    expect(statusWords('uploading')).toBe('Uploading')
    expect(statusWords('processing')).toBe('Saving')
    expect(statusWords('done')).toBe('Done')
    expect(statusWords('failed')).toBe('Failed')
  })
  it('keeps a video quiet until it can actually be played', () => {
    expect(statusWords('done', 'pending')).toBe('Preparing preview')
    expect(statusWords('done', 'ready')).toBe('Done')
    expect(statusWords('done', null)).toBe('Done')
  })
})

describe('isSettled', () => {
  it('is true only where nothing more will happen', () => {
    expect(isSettled('done')).toBe(true)
    expect(isSettled('failed')).toBe(true)
    for (const s of ['queued', 'uploading', 'processing'] as const) expect(isSettled(s)).toBe(false)
  })
})

describe('overallProgress', () => {
  it('counts finished files and the bytes behind them', () => {
    const o = overallProgress([
      { loaded: 100, total: 100, status: 'done' },
      { loaded: 50, total: 100, status: 'uploading' },
    ])
    expect(o.done).toBe(1)
    expect(o.files).toBe(2)
    expect(o.percent).toBe(75)
    expect(o.label).toBe('1 of 2 files · 75%')
    expect(o.active).toBe(true)
  })

  it('weights by BYTES, so five small files do not read as nearly finished', () => {
    // the specific wrongness that teaches people to distrust a bar: five 3 MB
    // files done, a 1 GB file untouched — by file count that is 83%
    const rows = [
      ...Array.from({ length: 5 }, () => ({ loaded: 3 * MB, total: 3 * MB, status: 'done' as const })),
      { loaded: 0, total: 1024 * MB, status: 'uploading' as const },
    ]
    expect(overallProgress(rows).percent).toBe(1)
  })

  it('lets a batch with a failure still reach 100%', () => {
    // the batch is not going any further; a bar that can never fill is a lie
    const o = overallProgress([
      { loaded: 100, total: 100, status: 'done' },
      { loaded: 20, total: 100, status: 'failed' },
    ])
    expect(o.percent).toBe(100)
    expect(o.done).toBe(1)
    expect(o.active).toBe(false)
  })

  it('falls back to counting files when no size is known', () => {
    const o = overallProgress([
      { loaded: 0, total: 0, status: 'done' },
      { loaded: 0, total: 0, status: 'uploading' },
    ])
    expect(o.percent).toBe(50)
  })

  it('says "1 file", not "1 files"', () => {
    expect(overallProgress([{ loaded: 1, total: 1, status: 'done' }]).label)
      .toBe('1 of 1 file · 100%')
  })

  it('is empty rather than NaN with nothing to report', () => {
    expect(overallProgress([])).toMatchObject({ done: 0, files: 0, percent: 0, active: false })
  })
})
