import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MAX_FPS, ffmpegArgs, ffprobeArgs, fitsBudget, outputFps, parseFrameRate,
  parseProbe, targetDimensions, targetProblem, toneMapNeeded, videoKbpsOf,
  worstCaseMB, TONE_MAP_FILTER_NAME, TONE_MAP_MISSING_MESSAGE,
  type EncodeTarget,
} from '../src/ladder.js'

/**
 * The ladder is the only part of this service that decides anything, so it is
 * the only part with tests. Everything else runs ffmpeg or moves bytes, and a
 * test of those would either be a test of ffmpeg or a test of a mock.
 */

const instagram: EncodeTarget = {
  platform: 'instagram',
  maxMB: 300,
  maxSeconds: 90,
  maxrateKbps: 10_000,
  bufsizeKbps: 20_000,
  audioKbps: 160,
  longSide: 1920,
  shortSide: 1080,
  maxFps: 30,
}

const arg = (args: string[], flag: string): string | undefined => {
  const i = args.indexOf(flag)
  return i === -1 ? undefined : args[i + 1]
}

describe('the size budget', () => {
  it('measures the worst case a channel could be sent', () => {
    // 10,160 kbps for 90 seconds is 114 MB, well inside Instagram's 300
    expect(worstCaseMB(instagram)).toBeCloseTo(114.3, 1)
    expect(fitsBudget(instagram)).toBe(true)
  })

  it('refuses a ladder that would overrun the channel', () => {
    const greedy = { ...instagram, maxrateKbps: 40_000 }
    expect(fitsBudget(greedy)).toBe(false)
    expect(targetProblem(greedy)).toMatch(/over the 300 MB/)
  })
})

describe('what the copy measures', () => {
  it('makes 4K landscape 1920 x 1080', () => {
    expect(targetDimensions({ width: 3840, height: 2160 }, instagram)).toEqual({ width: 1920, height: 1080 })
  })
  it('makes 4K vertical 1080 x 1920', () => {
    expect(targetDimensions({ width: 2160, height: 3840 }, instagram)).toEqual({ width: 1080, height: 1920 })
  })
  it('makes a square master 1080 x 1080', () => {
    expect(targetDimensions({ width: 2160, height: 2160 }, instagram)).toEqual({ width: 1080, height: 1080 })
  })
  it('leaves a 1080 x 1920 reel exactly as it is', () => {
    expect(targetDimensions({ width: 1080, height: 1920 }, instagram)).toEqual({ width: 1080, height: 1920 })
  })
  it('never upscales', () => {
    expect(targetDimensions({ width: 720, height: 1280 }, instagram)).toEqual({ width: 720, height: 1280 })
  })
  it('keeps both sides even', () => {
    const { width, height } = targetDimensions({ width: 1439, height: 2559 }, instagram)
    expect(width % 2).toBe(0)
    expect(height % 2).toBe(0)
  })
  it('caps an extreme aspect on its long side', () => {
    // 4000 x 1000 is 4:1 — the short side is already under 1080, so the long
    // side is what has to give
    expect(targetDimensions({ width: 4000, height: 1000 }, instagram)).toEqual({ width: 1920, height: 480 })
  })
})

describe('the frame rate', () => {
  it('keeps the source rate under the cap', () => {
    expect(outputFps({ fps: 24 }, instagram)).toBe(24)
    expect(outputFps({ fps: 23.976 }, instagram)).toBe(23.98)
  })
  it('caps 60 fps at 30', () => {
    expect(outputFps({ fps: 60 }, instagram)).toBe(30)
  })
  it('keeps 60 where the channel allows it', () => {
    expect(outputFps({ fps: 60 }, { maxFps: 60 })).toBe(60)
  })
  it('falls back to the cap when the source will not say', () => {
    expect(outputFps({}, {})).toBe(DEFAULT_MAX_FPS)
    expect(outputFps({ fps: 0 }, instagram)).toBe(30)
  })
})

describe('the ffmpeg arguments', () => {
  const args = ffmpegArgs({
    inputPath: '/tmp/x/source',
    outputPath: '/tmp/x/instagram.mp4',
    target: instagram,
    source: { width: 3840, height: 2160, fps: 25, durationSec: 20 },
  })

  it('is H.264 High at level 4.1, never HEVC', () => {
    expect(arg(args, '-c:v')).toBe('libx264')
    expect(arg(args, '-profile:v')).toBe('high')
    expect(arg(args, '-level')).toBe('4.1')
    expect(args).not.toContain('libx265')
  })

  it('is constrained quality, not a fixed bitrate', () => {
    expect(arg(args, '-crf')).toBe('20')
    expect(arg(args, '-maxrate')).toBe('10000k')
    expect(arg(args, '-bufsize')).toBe('20000k')
    expect(args).not.toContain('-b:v')
  })

  it('scales to the ladder and lands on yuv420p', () => {
    expect(arg(args, '-vf')).toBe('scale=1920:1080:flags=lanczos,format=yuv420p')
  })

  it('tags BT.709 rather than leaving it to be guessed', () => {
    expect(arg(args, '-color_primaries')).toBe('bt709')
    expect(arg(args, '-color_trc')).toBe('bt709')
    expect(arg(args, '-colorspace')).toBe('bt709')
  })

  it('is constant frame rate with a two-second keyframe interval', () => {
    expect(arg(args, '-r')).toBe('25')
    expect(arg(args, '-fps_mode')).toBe('cfr')
    expect(arg(args, '-g')).toBe('50')
    expect(arg(args, '-keyint_min')).toBe('50')
    expect(arg(args, '-sc_threshold')).toBe('0')
  })

  it('is AAC 160k stereo at 48 kHz', () => {
    expect(arg(args, '-c:a')).toBe('aac')
    expect(arg(args, '-b:a')).toBe('160k')
    expect(arg(args, '-ac')).toBe('2')
    expect(arg(args, '-ar')).toBe('48000')
  })

  it('writes an mp4 the platform can start reading straight away', () => {
    expect(arg(args, '-movflags')).toBe('+faststart')
    expect(arg(args, '-f')).toBe('mp4')
    expect(args[args.length - 1]).toBe('/tmp/x/instagram.mp4')
  })

  it('reads its input from a file, never from a URL', () => {
    expect(arg(args, '-i')).toBe('/tmp/x/source')
  })
})

describe('what a job description has to carry', () => {
  it('accepts a whole target', () => {
    expect(targetProblem(instagram)).toBeNull()
  })
  it('names the missing number', () => {
    expect(targetProblem({ ...instagram, maxrateKbps: 0 })).toBe('target.maxrateKbps must be a positive number')
    expect(targetProblem({ ...instagram, longSide: undefined })).toBe('target.longSide must be a positive number')
  })
  it('refuses a platform that is not a channel name', () => {
    expect(targetProblem({ ...instagram, platform: '../../etc' })).toBe('target.platform is not a channel name')
    expect(targetProblem({ ...instagram, platform: '' })).toBe('target.platform is missing')
  })
  it('refuses nothing at all', () => {
    expect(targetProblem(null)).toBe('target is missing')
  })
})

describe('reading what ffprobe says', () => {
  it('turns a fraction into a rate', () => {
    expect(parseFrameRate('30000/1001')).toBeCloseTo(29.97, 2)
    expect(parseFrameRate('25/1')).toBe(25)
    expect(parseFrameRate('0/0')).toBeUndefined()
    expect(parseFrameRate(undefined)).toBeUndefined()
  })

  it('picks the video stream out', () => {
    expect(parseProbe({
      format: { duration: '19.98' },
      streams: [
        { codec_type: 'audio' },
        { codec_type: 'video', width: 1080, height: 1920, avg_frame_rate: '30/1' },
      ],
    })).toEqual({ width: 1080, height: 1920, fps: 30, durationSec: 19.98 })
  })

  it('says no when there is no picture in the file', () => {
    expect(parseProbe({ streams: [{ codec_type: 'audio' }] })).toBeNull()
    expect(parseProbe(null)).toBeNull()
  })

  it('asks ffprobe for json about both the format and the streams', () => {
    expect(ffprobeArgs('/tmp/x/source')).toEqual([
      '-hide_banner', '-loglevel', 'error', '-print_format', 'json',
      '-show_format', '-show_streams', '/tmp/x/source',
    ])
  })
})

describe('the bitrate a copy came out at', () => {
  it('takes the audio back off the total', () => {
    // 20 seconds at 10 Mbps video + 160k audio is about 25.4 MB
    expect(videoKbpsOf(25_400_000, 20, 160)).toBe(10_000)
  })
  it('says nothing when it cannot know', () => {
    expect(videoKbpsOf(1000, undefined, 160)).toBeNull()
    expect(videoKbpsOf(0, 20, 160)).toBeNull()
  })
})

describe('an HDR master is converted, not relabelled', () => {
  const hdr = (transfer: string) => ({
    width: 3840, height: 2160, fps: 30, durationSec: 20,
    colorTransfer: transfer, colorPrimaries: 'bt2020',
  })

  it('recognises HLG and PQ, and nothing else', () => {
    expect(toneMapNeeded({ colorTransfer: 'arib-std-b67' })).toBe('HLG')
    expect(toneMapNeeded({ colorTransfer: 'ARIB-STD-B67' })).toBe('HLG')
    expect(toneMapNeeded({ colorTransfer: 'smpte2084' })).toBe('PQ (HDR10)')
    expect(toneMapNeeded({ colorTransfer: 'bt709' })).toBeNull()
    expect(toneMapNeeded({ colorTransfer: 'bt2020-10' })).toBeNull()   // wide gamut, SDR curve
    expect(toneMapNeeded({})).toBeNull()
  })

  it('tone-maps an HLG master BEFORE it scales it', () => {
    const args = ffmpegArgs({
      inputPath: '/tmp/x/source', outputPath: '/tmp/x/instagram.mp4',
      target: instagram, source: hdr('arib-std-b67'),
    })
    expect(arg(args, '-vf')).toBe(
      'zscale=t=linear:npl=100,tonemap=hable,zscale=p=bt709:t=bt709:m=bt709,'
      + 'scale=1920:1080:flags=lanczos,format=yuv420p',
    )
    // …and the tags still say 709, because by now the pixels really are
    expect(arg(args, '-colorspace')).toBe('bt709')
  })

  it('tone-maps a PQ master the same way', () => {
    const args = ffmpegArgs({
      inputPath: '/tmp/x/source', outputPath: '/tmp/x/instagram.mp4',
      target: instagram, source: hdr('smpte2084'),
    })
    expect(arg(args, '-vf')).toContain('tonemap=hable')
  })

  it('leaves an ordinary BT.709 clip alone', () => {
    const args = ffmpegArgs({
      inputPath: '/tmp/x/source', outputPath: '/tmp/x/instagram.mp4',
      target: instagram,
      source: { width: 1080, height: 1920, fps: 30, colorTransfer: 'bt709' },
    })
    expect(arg(args, '-vf')).toBe('scale=1080:1920:flags=lanczos,format=yuv420p')
    expect(arg(args, '-vf')).not.toContain('zscale')
  })

  it('reads the colour tags off ffprobe', () => {
    expect(parseProbe({
      format: { duration: '20' },
      streams: [{
        codec_type: 'video', width: 1080, height: 1920, avg_frame_rate: '30/1',
        color_transfer: 'arib-std-b67', color_primaries: 'bt2020',
      }],
    })).toEqual({
      width: 1080, height: 1920, fps: 30, durationSec: 20,
      colorTransfer: 'arib-std-b67', colorPrimaries: 'bt2020',
    })
  })

  it('has a sentence for a machine that cannot do it', () => {
    expect(TONE_MAP_MISSING_MESSAGE).toMatch(/HDR/)
    expect(TONE_MAP_MISSING_MESSAGE).toMatch(/BT\.709/)
    expect(TONE_MAP_FILTER_NAME).toBe('zscale')
  })
})
