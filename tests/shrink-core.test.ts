import { describe, it, expect } from 'vitest'
import {
  channelsNeedingCopy, cleanCopyWords, copyDimensions, copyWords, probeForCopy,
  tightestChannel,
} from '../app/lib/shrink-core'
import type { AssetProbe } from '../app/lib/media-fit-core'

const MB = 1024 * 1024
const master: AssetProbe = {
  url: 'https://cdn.example.invalid/master.mp4', type: 'video', mime: 'video/mp4',
  bytes: 2048 * MB, width: 3840, height: 2160, seconds: 400,
}

describe('which channels get the smaller copy', () => {
  // the whole point of a 2 GB master: YouTube, TikTok and LinkedIn take it at
  // full quality, and only Instagram needs something smaller
  it('names the channels the master is too big to MOVE — YouTube and TikTok keep it', () => {
    // LinkedIn times out on a 2 GB master every time. TikTok looked the same
    // for an hour and was not: the provider reports a slow TikTok upload as
    // "failed — still processing, do not repost", and the 3:26 pm master went
    // live on TikTok 63 minutes later. Slow is not broken.
    expect(channelsNeedingCopy({
      probes: [master],
      platforms: ['instagram', 'youtube', 'tiktok', 'linkedin'],
      kinds: { instagram: 'reel' },
    })).toEqual(['instagram', 'linkedin'])
  })

  it('does not bother LinkedIn with a copy of a file the provider can move', () => {
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

/**
 * ONE copy is made and every waiting channel gets it, so it has to be made
 * for the tightest of them. A file that fits Instagram fits X; the other way
 * round it does not. Taking the first of the list was taking whichever
 * channel happened to be ticked first, which is not a rule at all.
 */
describe('which channel the one copy is made for', () => {
  it('is the one with the least room', () => {
    // Instagram 300 MB, X 512 MB, TikTok 4 GB
    expect(tightestChannel(['tiktok', 'twitter', 'instagram'])).toBe('instagram')
    expect(tightestChannel(['tiktok', 'twitter'])).toBe('twitter')
    expect(tightestChannel(['tiktok'])).toBe('tiktok')
  })

  it('judges each channel on the kind it is posting as', () => {
    // an Instagram Story takes 100 MB where a Reel takes 300
    expect(tightestChannel(['instagram', 'twitter'], { instagram: 'story' })).toBe('instagram')
    expect(tightestChannel(['twitter', 'instagram'], { instagram: 'story' })).toBe('instagram')
  })

  it('answers the same way twice, and nothing at all for nothing', () => {
    expect(tightestChannel([])).toBeNull()
    expect(tightestChannel(['instagram', 'instagram'])).toBe('instagram')
  })

  it('says how long a clean copy usually takes, in words', () => {
    expect(cleanCopyWords('TikTok')).toBe('Making a clean copy for TikTok — usually a few minutes')
    // and that sentence is what the channel's row shows
    expect(copyWords('TikTok', { status: 'encoding', percent: null, note: cleanCopyWords('TikTok') }))
      .toBe('Making a clean copy for TikTok — usually a few minutes')
  })
})
