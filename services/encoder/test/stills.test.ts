import { describe, expect, it } from 'vitest'
import {
  SCRUB_KEYFRAME_EVERY, SCRUB_MAX_FRAMES, STILL_SCALE, STILL_SHORT_SIDE,
  parseStills, posterArgs, posterSecond, scrubArgs, scrubFps,
} from '../src/stills.js'
import { parseJob } from '../src/request.js'
import { JobQueue } from '../src/queue.js'
import type { EncodeTarget } from '../src/ladder.js'

/**
 * The clip's own poster and scrub copy (22 Nov 2026). The owner's word: "I need exact frames, so when it is hovered
 * it is the actual hover process", not a fixed set of pictures. What is pinned here is what makes that true: the
 * scrub copy keeps EVERY frame of an ordinary clip, runs the clip's own length, and has a keyframe every six frames
 * (measured in Chrome that day: 6 ms a jump, against 50 for the ordinary copy).
 */

const POSTER = 'https://acct.r2.cloudflarestorage.com/x.poster.jpg?X-Amz-Signature=s'
const SCRUB = 'https://acct.r2.cloudflarestorage.com/x.scrub.mp4?X-Amz-Signature=s'

describe('what ffmpeg is told', () => {
  it('the poster is a moment in, never frame zero, and never past a short clip', () => {
    expect(posterSecond(15.4)).toBe(1)
    expect(posterSecond(0.8)).toBeCloseTo(0.4)
    expect(posterSecond(0)).toBe(0)
    const a = posterArgs('in.mp4', 'p.jpg', 15.4)
    expect(a.slice(a.indexOf('-ss'), a.indexOf('-ss') + 2)).toEqual(['-ss', '1.000'])
    expect(a).toContain(STILL_SCALE)
    expect(a[a.length - 1]).toBe('p.jpg')
  })

  it('an ordinary clip keeps every frame: its rate is left alone', () => {
    expect(scrubFps(15.4, 25)).toBeNull()
    expect(scrubFps(48, 25)).toBeNull()
    const a = scrubArgs('in.mp4', 's.mp4', 15.4, 25)
    expect(a[a.indexOf('-vf') + 1]).toBe(STILL_SCALE)
  })

  it('a long clip is thinned evenly to the most a tile should load, and still runs its own length', () => {
    expect(SCRUB_MAX_FRAMES).toBe(1200)
    expect(scrubFps(300, 25)).toBeCloseTo(4)
    expect(scrubFps(60, 60)).toBeCloseTo(20)
    const a = scrubArgs('in.mp4', 's.mp4', 300, 25)
    expect(a[a.indexOf('-vf') + 1]!.startsWith('fps=4.0000,')).toBe(true)
    // no -t, no trim: a moment in the scrub copy is the same moment in the clip
    expect(a).not.toContain('-t')
  })

  it('built to be jumped around in: a keyframe every six frames, silent, its index at the front', () => {
    expect(SCRUB_KEYFRAME_EVERY).toBe(6)
    const a = scrubArgs('in.mp4', 's.mp4', 15.4, 25)
    expect(a.slice(a.indexOf('-g'), a.indexOf('-g') + 2)).toEqual(['-g', '6'])
    expect(a.slice(a.indexOf('-keyint_min'), a.indexOf('-keyint_min') + 2)).toEqual(['-keyint_min', '6'])
    expect(a.slice(a.indexOf('-sc_threshold'), a.indexOf('-sc_threshold') + 2)).toEqual(['-sc_threshold', '0'])
    expect(a).toContain('-an')
    expect(a.slice(a.indexOf('-movflags'), a.indexOf('-movflags') + 2)).toEqual(['-movflags', '+faststart'])
    expect(a.slice(a.indexOf('-pix_fmt'), a.indexOf('-pix_fmt') + 2)).toEqual(['-pix_fmt', 'yuv420p'])
    expect(a[a.length - 1]).toBe('s.mp4')
  })

  it('the SHORT side is the fixed one, and a small copy is never blown up', () => {
    expect(STILL_SHORT_SIDE).toBe(720)
    expect(STILL_SCALE).toBe("scale='if(gt(iw,ih),-2,min(720,iw))':'if(gt(iw,ih),min(720,ih),-2)'")
  })
})

describe('reading the ask', () => {
  it('no stills is no stills, not a refusal', () => {
    expect(parseStills(undefined)).toBeNull()
    expect(parseStills(null)).toBeNull()
  })
  it('takes an https poster and an https scrub address', () => {
    expect(parseStills({ posterUrl: POSTER, scrubUrl: SCRUB })).toEqual({ posterUrl: POSTER, scrubUrl: SCRUB })
  })
  it('refuses anything else', () => {
    expect(parseStills({ posterUrl: 'http://x/p.jpg', scrubUrl: SCRUB })).toHaveProperty('problem')
    expect(parseStills({ posterUrl: POSTER })).toHaveProperty('problem')
    expect(parseStills({ posterUrl: POSTER, scrubUrl: 'file:///etc/passwd' })).toHaveProperty('problem')
  })
})

describe('on a job', () => {
  const target: EncodeTarget = {
    platform: 'instagram', maxMB: 300, maxSeconds: 90,
    maxrateKbps: 10_000, bufsizeKbps: 20_000, audioKbps: 160,
    longSide: 1920, shortSide: 1080, maxFps: 30,
  }
  const HOSTS = ['media.mdmmarketing.com.au']
  const base = {
    jobId: 'abc123__instagram',
    sourceUrl: 'https://media.mdmmarketing.com.au/master.mov',
    uploadUrl: 'https://acct.r2.cloudflarestorage.com/copy.mp4?X-Amz-Signature=x',
    callbackUrl: 'https://app.mdmmarketing.com.au/api/media/encode/callback',
    target,
  }
  const stills = { posterUrl: POSTER, scrubUrl: SCRUB }

  it('an encode carries its pictures along, and one without them is the job it always was', () => {
    const plain = parseJob(base, HOSTS)
    expect('job' in plain && plain.job.stills).toBeUndefined()
    const withPics = parseJob({ ...base, stills }, HOSTS)
    expect('job' in withPics && withPics.job.stills).toEqual(stills)
  })

  it('a bad pictures ask refuses the whole job, rather than quietly dropping the pictures', () => {
    expect(parseJob({ ...base, stills: { posterUrl: 'nope', scrubUrl: SCRUB } }, HOSTS)).toHaveProperty('problem')
  })

  it('a pictures-only job needs no target and no upload address, but does need its pictures and a pinned source', () => {
    const only = { jobId: base.jobId, sourceUrl: 'https://media.mdmmarketing.com.au/copy.mp4', callbackUrl: base.callbackUrl, only: 'stills', stills }
    const ok = parseJob(only, HOSTS)
    expect('stillsJob' in ok && ok.stillsJob.stills).toEqual(stills)
    expect(parseJob({ ...only, stills: undefined }, HOSTS)).toHaveProperty('problem')
    expect(parseJob({ ...only, sourceUrl: 'https://evil.example.com/copy.mp4' }, HOSTS)).toHaveProperty('problem')
  })
})

describe('the pictures line', () => {
  it('holds as many as it is told to, where the encode line holds two', () => {
    const never = () => new Promise<void>(() => {})
    const encodes = new JobQueue()
    expect([1, 2, 3, 4].map(i => encodes.add(`e${i}`, never))).toEqual([true, true, true, false])
    const pictures = new JobQueue(40)
    const took = Array.from({ length: 42 }, (_, i) => pictures.add(`p${i}`, never))
    expect(took.filter(Boolean)).toHaveLength(41)
    expect(took[41]).toBe(false)
  })
})
