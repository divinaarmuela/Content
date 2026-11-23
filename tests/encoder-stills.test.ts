import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { encoderStills, stillKeys } from '../app/lib/playable-core'
import { copiesWithoutStills } from '../app/lib/stream-core'
import { parseReport } from '../app/lib/encoder'

/**
 * THE COPY'S OWN POSTER AND SCRUB COPY (the owner, 22 Nov 2026: "I need exact frames, so when it is hovered it is the
 * actual hover process"). Our encoder makes a sharp poster and a small every-frame scrub copy from each copy and
 * stores them beside it; the app keeps only a flag and works both addresses out from the copy's key. A first try cut
 * thirty fixed pictures, and the owner's word was that a slideshow is not scrubbing: that is pinned out below.
 */

const MASTER = 'https://pub-x.r2.dev/pulls/folder/4._STINGER.mov'
const row = (over: Record<string, unknown> = {}) => ({
  source_url: MASTER, status: 'done', platform: 'instagram', output_key: '1795-xa1jat-copy-instagram.mp4', stills: 1, duration_sec: 15.4, ...over,
})

describe('where they are', () => {
  it('beside the copy, named from its key, with no folder in the name', () => {
    const k = stillKeys('1795-xa1jat-copy-instagram.mp4')
    expect(k).toEqual({ poster: '1795-xa1jat-copy-instagram.poster.jpg', scrub: '1795-xa1jat-copy-instagram.scrub.mp4' })
    for (const key of [k.poster, k.scrub]) expect(key.includes('/')).toBe(false)
  })

  it('a master with them gets a poster, a scrub copy and its length, at the bucket root', () => {
    expect(encoderStills(MASTER, [row()])).toEqual({
      poster: 'https://pub-x.r2.dev/1795-xa1jat-copy-instagram.poster.jpg',
      scrub: 'https://pub-x.r2.dev/1795-xa1jat-copy-instagram.scrub.mp4',
      duration: 15.4,
    })
  })

  it('none is none: a copy still being made, one without them, one whose length is not known, another file', () => {
    expect(encoderStills(MASTER, [row({ status: 'running' })])).toBeNull()
    expect(encoderStills(MASTER, [row({ stills: 0 })])).toBeNull()
    expect(encoderStills(MASTER, [row({ stills: null })])).toBeNull()
    expect(encoderStills(MASTER, [row({ duration_sec: null })])).toBeNull()
    expect(encoderStills('https://pub-x.r2.dev/other.mov', [row()])).toBeNull()
    expect(encoderStills('https://pub-x.r2.dev/picture.jpg', [row({ source_url: 'https://pub-x.r2.dev/picture.jpg' })])).toBeNull()
  })
})

describe('the copies made before the encoder made these', () => {
  it('are the finished ones never asked: null, not 0', () => {
    const jobs = [
      { id: 'a', status: 'done', output_key: 'a.mp4', stills: null },
      { id: 'b', status: 'done', output_key: 'b.mp4' },
      { id: 'c', status: 'done', output_key: 'c.mp4', stills: 0 },
      { id: 'd', status: 'done', output_key: 'd.mp4', stills: 1 },
      { id: 'e', status: 'queued', output_key: 'e.mp4', stills: null },
      { id: 'f', status: 'done', output_key: null, stills: null },
    ]
    expect(copiesWithoutStills(jobs).map(j => j.id)).toEqual(['a', 'b'])
  })
  it('a batch at a time', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ id: String(i), status: 'done', output_key: `${i}.mp4`, stills: null }))
    expect(copiesWithoutStills(many)).toHaveLength(40)
  })
})

describe('the encoder’s report', () => {
  it('says whether they were made, and when it is an answer about them only', () => {
    expect(parseReport({ jobId: 'j', ok: true, bytes: 8_000_000, stills: 1 })).toMatchObject({ stills: 1, only: null })
    expect(parseReport({ jobId: 'j', ok: true, only: 'stills', stills: 1 })).toMatchObject({ stills: 1, only: 'stills' })
    expect(parseReport({ jobId: 'j', ok: true, bytes: 1 })).toMatchObject({ stills: null, only: null })
    expect(parseReport({ jobId: 'j', ok: false, only: 'stills', stills: 0 })).toMatchObject({ stills: 0, only: 'stills' })
    expect(parseReport({ jobId: 'j', ok: true, stills: 99999 })!.stills).toBe(1)
  })
})

describe('wired through (source pins)', () => {
  const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
  it('the ask carries both addresses, signed from the copy’s own key, each for its own kind of file', () => {
    const run = read('app/lib/encode-run.ts')
    expect(run).toContain('stills: await signStills(key),')
    expect(run).toContain("posterUrl: await sign(keys.poster, 'image/jpeg'), scrubUrl: await sign(keys.scrub, 'video/mp4')")
  })
  it('an answer about them only settles nothing: it writes the flag onto a finished copy', () => {
    const cb = read('app/api/media/encode/callback/route.ts')
    expect(cb.indexOf("if (report.only === 'stills')")).toBeGreaterThan(0)
    expect(cb.indexOf("if (report.only === 'stills')")).toBeLessThan(cb.indexOf('const settled = await settleEncodeJob({'))
    expect(read('app/lib/encode-jobs.ts')).toContain("cur && cur.status === 'done' ? { ...cur, stills, updated_at")
  })
  it('the tile is the poster at rest and the clip itself under the pointer, every frame of it', () => {
    const tiles = read('app/dashboard/board/DriveFolderFiles.tsx')
    expect(tiles).toContain('const ownStills = (t: FolderTile) => encoderStills(t.preview, encodeRows)')
    expect(tiles).toContain('poster={ownStills(t)!.poster} duration={ownStills(t)!.duration} scrub={ownStills(t)!.scrub} />')
    expect(tiles).toContain('data-tile-wait')
    expect(tiles).not.toContain('<HoverClip src={t.preview}')
    const clip = read('app/components/media/HoverClip.tsx')
    // loaded on the first hover and not before; jumps to the exact moment, one jump at a time, always the latest
    expect(clip).toContain('if (scrubbing) { setArmed(true); return }')
    // read whole with fetch and played from memory, so no tile ever holds one of storage's six connections
    expect(clip).toContain('fetch(scrub, { signal: stop.signal })')
    expect(clip).toContain('made = URL.createObjectURL(b); setScrubSrc(made)')
    expect(clip).toContain('if (made) URL.revokeObjectURL(made)')
    expect(clip).toContain('{scrubSrc && (')
    expect(clip).toContain('<video ref={scrubRef} src={scrubSrc} muted playsInline preload="auto"')
    expect(clip).not.toContain('src={scrub} muted')
    expect(clip).toContain('v.currentTime = t')
    expect(clip).toContain('onSeeked={scrubSeek}')
  })
  it('not a slideshow: no fixed set of pictures anywhere', () => {
    expect(read('app/lib/playable-core.ts')).not.toMatch(/STILL_FRAMES|stillIndex/)
    const enc = read('services/encoder/src/stills.ts')
    expect(enc).not.toMatch(/frameUrls|framesArgs/)
    expect(enc).toContain('export const SCRUB_KEYFRAME_EVERY = 6')
    expect(enc).toContain('export const SCRUB_MAX_FRAMES = 1200')
  })
  it('the half-hourly sweep asks for them for copies that have none', () => {
    const sweep = read('app/lib/stream.ts')
    expect(sweep).toContain('bare = copiesWithoutStills(jobs)')
    expect(sweep).toContain('if (await askForStills(j)) pictured++; else break')
  })
})
