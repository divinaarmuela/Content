import { describe, it, expect } from 'vitest'
import {
  formatFileSize, previewBlock, probeVideoBytes, uploadWarning,
} from '../app/lib/video-probe-core'

/* ------------------------------------------------------------------ *
 * Hand-built files. Everything here is a real MP4 box layout, just
 * with a few bytes of picture data where 184 MB would be.
 * ------------------------------------------------------------------ */

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}

function box(type: string, ...payload: Uint8Array[]): Uint8Array {
  const body = concat(...payload)
  const out = new Uint8Array(8 + body.length)
  const size = out.length
  out[0] = (size >>> 24) & 0xff
  out[1] = (size >>> 16) & 0xff
  out[2] = (size >>> 8) & 0xff
  out[3] = size & 0xff
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(body, 8)
  return out
}

/** A box that claims to be `size` bytes long but whose bytes stop early —
 *  which is every `mdat` in a file bigger than the probe window. */
function hugeBox(type: string, claimedSize: number, present: number): Uint8Array {
  const out = new Uint8Array(8 + present)
  out[0] = (claimedSize >>> 24) & 0xff
  out[1] = (claimedSize >>> 16) & 0xff
  out[2] = (claimedSize >>> 8) & 0xff
  out[3] = claimedSize & 0xff
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  return out
}

const ascii = (s: string) => new Uint8Array([...s].map(c => c.charCodeAt(0)))
const zeros = (n: number) => new Uint8Array(n)

function ftyp(brand: string): Uint8Array {
  return box('ftyp', ascii(brand), zeros(4), ascii(brand))
}

/** stsd holding one sample entry of the given four-character format. */
function stsd(...formats: string[]): Uint8Array {
  const count = new Uint8Array([0, 0, 0, formats.length])
  const entries = formats.map(f => box(f))
  return box('stsd', zeros(4), count, ...entries)
}

function trak(...formats: string[]): Uint8Array {
  return box('trak', box('mdia', box('minf', box('stbl', stsd(...formats)))))
}

function moov(...traks: Uint8Array[]): Uint8Array {
  return box('moov', box('mvhd', zeros(100)), ...traks)
}

const mdat = (n = 64) => box('mdat', zeros(n))

describe('probeVideoBytes — the container', () => {
  it('reads an mp4 brand', () => {
    const p = probeVideoBytes(concat(ftyp('isom'), moov(trak('avc1')), mdat()))
    expect(p.container).toBe('mp4')
    expect(p.brand).toBe('isom')
  })

  it('reads a QuickTime brand as mov', () => {
    const p = probeVideoBytes(concat(ftyp('qt  '), moov(trak('avc1')), mdat()))
    expect(p.container).toBe('mov')
    expect(p.brand).toBe('qt  ')
  })

  it('accepts an old QuickTime file that carries no ftyp at all', () => {
    const p = probeVideoBytes(concat(box('wide', zeros(8)), mdat(), moov(trak('avc1'))))
    expect(p.container).toBe('mov')
    expect(p.brand).toBeNull()
  })

  it('has no opinion about bytes that are not an MP4 family file', () => {
    const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4, 5, 6, 7, 8])
    const p = probeVideoBytes(webm)
    expect(p.container).toBe('other')
    expect(p.fastStart).toBeNull()
    expect(previewBlock(p, 200_000_000)).toBeNull()
  })

  it('never throws on empty or tiny input', () => {
    expect(probeVideoBytes(new Uint8Array(0)).container).toBe('other')
    expect(probeVideoBytes(new Uint8Array([0, 0, 0, 4])).container).toBe('other')
  })
})

describe('probeVideoBytes — fast start', () => {
  it('moov before mdat is fast start', () => {
    const p = probeVideoBytes(concat(ftyp('mp42'), moov(trak('avc1')), mdat(4096)))
    expect(p.fastStart).toBe(true)
  })

  it('moov after a SMALL mdat is definitively not fast start', () => {
    const p = probeVideoBytes(concat(ftyp('qt  '), mdat(256), moov(trak('avc1'))))
    expect(p.fastStart).toBe(false)
  })

  it('a 184 MB mdat with no moov in reach is undetermined, not a pass', () => {
    // exactly the failing file: ftyp, then picture data that runs past
    // everything we downloaded, with the index somewhere out at 184 MB
    const p = probeVideoBytes(concat(ftyp('qt  '), hugeBox('mdat', 184_000_000, 2048)))
    expect(p.fastStart).toBeNull()
    expect(p.container).toBe('mov')
    expect(previewBlock(p, 184_000_000)?.kind).toBe('fast-start')
  })

  it('skips free/wide padding on the way to moov', () => {
    const p = probeVideoBytes(concat(
      ftyp('isom'), box('free', zeros(64)), box('wide', zeros(8)), moov(trak('avc1')), mdat(),
    ))
    expect(p.fastStart).toBe(true)
    expect(p.codec).toBe('h264')
  })

  it('an mdat declared as running to the end of the file is undetermined', () => {
    const zeroSized = concat(new Uint8Array([0, 0, 0, 0]), ascii('mdat'), zeros(64))
    const p = probeVideoBytes(concat(ftyp('qt  '), zeroSized))
    expect(p.fastStart).toBeNull()
  })

  it('a truncated moov still answers the fast-start question', () => {
    const full = concat(ftyp('isom'), moov(trak('avc1')), mdat(4096))
    const cut = full.slice(0, 40)
    const p = probeVideoBytes(cut)
    expect(p.fastStart).toBe(true)
  })
})

describe('probeVideoBytes — codec', () => {
  it('finds avc1 through moov > trak > mdia > minf > stbl > stsd', () => {
    const p = probeVideoBytes(concat(ftyp('isom'), moov(trak('avc1')), mdat()))
    expect(p.codec).toBe('h264')
    expect(p.codecTag).toBe('avc1')
  })

  it('finds HEVC', () => {
    const p = probeVideoBytes(concat(ftyp('qt  '), moov(trak('hvc1')), mdat()))
    expect(p.codec).toBe('hevc')
  })

  it('finds ProRes', () => {
    const p = probeVideoBytes(concat(ftyp('qt  '), moov(trak('ap4h')), mdat()))
    expect(p.codec).toBe('prores')
    expect(p.codecTag).toBe('ap4h')
  })

  it('walks past the audio track to the picture', () => {
    const p = probeVideoBytes(concat(ftyp('qt  '), moov(trak('mp4a'), trak('hev1')), mdat()))
    expect(p.codec).toBe('hevc')
  })

  it('reports an unknown format rather than guessing', () => {
    const p = probeVideoBytes(concat(ftyp('isom'), moov(trak('xyzw')), mdat()))
    expect(p.codec).toBe('other')
    expect(p.codecTag).toBe('xyzw')
  })

  it('leaves the codec unknown when moov is out past the probe window', () => {
    const p = probeVideoBytes(concat(ftyp('qt  '), hugeBox('mdat', 184_000_000, 1024)))
    expect(p.codec).toBeNull()
    expect(p.codecTag).toBeNull()
  })
})

describe('previewBlock', () => {
  const fast = probeVideoBytes(concat(ftyp('isom'), moov(trak('avc1')), mdat()))
  const slow = probeVideoBytes(concat(ftyp('qt  '), mdat(256), moov(trak('avc1'))))
  const hevc = probeVideoBytes(concat(ftyp('qt  '), moov(trak('hvc1')), mdat()))
  const prores = probeVideoBytes(concat(ftyp('qt  '), moov(trak('ap4h')), mdat()))

  it('passes a fast-start H.264 mp4', () => {
    expect(previewBlock(fast, 40_000_000)).toBeNull()
  })

  it('names the size in the index reason, and omits it when unknown', () => {
    expect(previewBlock(slow, 193_273_528)?.reason).toContain('(184 MB)')
    expect(previewBlock(slow)?.reason).not.toContain('(')
  })

  it('blames the codec before the index when both are wrong', () => {
    const both = probeVideoBytes(concat(ftyp('qt  '), mdat(256), moov(trak('ap4h'))))
    expect(both.fastStart).toBe(false)
    expect(previewBlock(both, 1)?.kind).toBe('codec')
  })

  it('says which codec', () => {
    expect(previewBlock(hevc)?.reason).toContain('HEVC')
    expect(previewBlock(prores)?.reason).toContain('ProRes')
  })

  it('has no opinion about nothing', () => {
    expect(previewBlock(null)).toBeNull()
  })
})

describe('formatFileSize', () => {
  it('rounds to the unit a person would say', () => {
    expect(formatFileSize(193_273_528)).toBe('184 MB')
    expect(formatFileSize(1024)).toBe('1 KB')
    expect(formatFileSize(3 * 1024 * 1024 * 1024)).toBe('3.0 GB')
    expect(formatFileSize(512)).toBe('512 B')
  })
  it('says nothing about a size it does not have', () => {
    expect(formatFileSize(0)).toBeNull()
    expect(formatFileSize(null)).toBeNull()
    expect(formatFileSize(Number.NaN)).toBeNull()
  })
})

describe('uploadWarning', () => {
  it('warns without blocking, and says how to fix the export', () => {
    const slow = probeVideoBytes(concat(ftyp('qt  '), mdat(256), moov(trak('avc1'))))
    const line = uploadWarning(slow, 193_273_528)
    expect(line).toContain("Won't preview in the browser")
    expect(line).toContain('184 MB')
    expect(line).toContain('still uploads and posts fine')
    expect(line).toContain('Web optimized')
  })
  it('says nothing about a file that plays', () => {
    const fast = probeVideoBytes(concat(ftyp('isom'), moov(trak('avc1')), mdat()))
    expect(uploadWarning(fast, 1000)).toBeNull()
  })
})
