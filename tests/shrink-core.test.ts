import { describe, it, expect } from 'vitest'
import { channelsNeedingCopy, copyDimensions, copyWords, probeForCopy } from '../app/lib/shrink-core'
import type { AssetProbe } from '../app/lib/media-fit-core'

const MB = 1024 * 1024
const master: AssetProbe = {
  url: 'https://cdn.example.invalid/master.mp4', type: 'video', mime: 'video/mp4',
  bytes: 2048 * MB, width: 3840, height: 2160, seconds: 400,
}

describe('which channels get the smaller copy', () => {
  // the whole point of a 2 GB master: YouTube, TikTok and LinkedIn take it at
  // full quality, and only Instagram needs something smaller
  it('names every channel the master is too big to MOVE — YouTube alone keeps it', () => {
    // TikTok and LinkedIn accept 4–5 GB on paper and never received a 2 GB
    // master through the provider, twice; the 11 MB copy to Instagram in the
    // same post was live in two minutes
    expect(channelsNeedingCopy({
      probes: [master],
      platforms: ['instagram', 'youtube', 'tiktok', 'linkedin'],
      kinds: { instagram: 'reel' },
    })).toEqual(['instagram', 'tiktok', 'linkedin'])
  })

  it('does not bother TikTok or LinkedIn with a copy the provider can move', () => {
    expect(channelsNeedingCopy({
      probes: [{ ...master, bytes: 400 * MB }],
      platforms: ['instagram', 'tiktok', 'linkedin', 'youtube'],
    })).toEqual(['instagram'])
  })

  it('leaves a channel alone once it has a file of its own', () => {
    expect(channelsNeedingCopy({
      probes: [master], platforms: ['instagram'],
      own: { instagram: [{ url: 'https://cdn.example.invalid/short.mp4', type: 'video' }] },
    })).toEqual([])
  })

  it('only ever shrinks a lone video — a carousel is not one file', () => {
    expect(channelsNeedingCopy({ probes: [master, master], platforms: ['instagram'] })).toEqual([])
    expect(channelsNeedingCopy({ probes: [{ ...master, type: 'image' }], platforms: ['instagram'] })).toEqual([])
    expect(channelsNeedingCopy({ probes: [{ ...master, bytes: undefined }], platforms: ['instagram'] })).toEqual([])
  })

  it('does nothing for a file that already fits', () => {
    expect(channelsNeedingCopy({ probes: [{ ...master, bytes: 200 * MB }], platforms: ['instagram', 'twitter'] }))
      .toEqual([])
  })
})

describe('what the copy measures', () => {
  it('caps the SHORTER side at 1080 and keeps the shape — a 1080 x 1920 Reel is untouched', () => {
    expect(copyDimensions({ width: 3840, height: 2160 })).toEqual({ width: 1920, height: 1080 })
    expect(copyDimensions({ width: 2160, height: 3840 })).toEqual({ width: 1080, height: 1920 })
    expect(copyDimensions({ width: 1080, height: 1920 })).toEqual({ width: 1080, height: 1920 })
    expect(copyDimensions({})).toEqual({})
  })

  it('builds the probe the check will judge, from the copy and the master', () => {
    const p = probeForCopy(master, { status: 'ready', url: 'https://x/default.mp4', bytes: 180 * MB })
    expect(p).toEqual({
      url: 'https://x/default.mp4', type: 'video', mime: 'video/mp4',
      bytes: 180 * MB, width: 1920, height: 1080, seconds: 400,
    })
  })
})

describe('the words on the row', () => {
  it('says what is happening, with the percentage when there is one', () => {
    expect(copyWords('Instagram', undefined)).toBe('Making a smaller copy for Instagram…')
    expect(copyWords('Instagram', { status: 'encoding', percent: 42 })).toBe('Making a smaller copy for Instagram — 42%')
    expect(copyWords('Instagram', { status: 'ready', url: 'u', bytes: 180 * MB }))
      .toBe('Instagram gets a smaller copy (180 MB) — the full file goes to the rest')
    expect(copyWords('Instagram', { status: 'failed', reason: 'the encode failed' }))
      .toBe('Could not make a smaller copy for Instagram: the encode failed')
  })
})
