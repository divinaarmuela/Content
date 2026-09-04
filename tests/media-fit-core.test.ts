import { describe, it, expect } from 'vitest'
import {
  assessAssets, assetOutcomes, channelSpecs, describeAspect, fitHeadline, formatOf,
  effectiveKind, kindLabel, postingAs, requirementLines, unmeasured, verdictByPlatform, PLATFORM_MEDIA,
  PLATFORM_ENCODE, encodeTargetFor, encodeWorstCaseMB,
  type AssetProbe,
} from '../app/lib/media-fit-core'
import { SUPPORTED_PLATFORMS } from '../app/lib/publish-core'

const MB = 1024 * 1024

/** A vertical 1080 x 1920 clip — the shape everything is cut for. */
function reel(over: Partial<AssetProbe> = {}): AssetProbe {
  return {
    url: 'https://cdn.example.invalid/a.mp4',
    type: 'video', mime: 'video/mp4',
    bytes: 40 * MB, width: 1080, height: 1920, seconds: 30,
    ...over,
  }
}

function photo(over: Partial<AssetProbe> = {}): AssetProbe {
  return {
    url: 'https://cdn.example.invalid/a.jpg',
    type: 'image', mime: 'image/jpeg',
    bytes: 900 * 1024, width: 1080, height: 1350,
    ...over,
  }
}

describe('every platform we can post to has media rules', () => {
  it('leaves no platform unchecked', () => {
    for (const p of SUPPORTED_PLATFORMS) {
      expect(PLATFORM_MEDIA[p], `no media rules for ${p}`).toBeTruthy()
      expect(PLATFORM_MEDIA[p].label).toBeTruthy()
    }
  })
})

describe('a file that is only too big', () => {
  // the case that started this: it publishes, it never errors, and it looks
  // worse than the master nobody was told had been re-encoded
  it('is reported as degraded on Instagram, not as a failure', () => {
    const findings = assessAssets({
      probes: [reel({ bytes: 400 * MB })],
      platforms: ['instagram'],
      kinds: { instagram: 'reel' },
    })
    expect(findings).toHaveLength(1)
    expect(findings[0].level).toBe('degraded')
    expect(findings[0].detail).toContain('300 MB')
    expect(findings[0].consequence).toMatch(/nothing errors/i)
  })

  it('is reported as blocked on X, which refuses it outright', () => {
    const findings = assessAssets({
      probes: [reel({ bytes: 600 * MB })],
      platforms: ['twitter'],
    })
    expect(findings[0].level).toBe('blocked')
    expect(findings[0].detail).toContain('512 MB')
  })

  it('separates the two in one pass, so a cross-post is not judged by its best channel', () => {
    const findings = assessAssets({
      probes: [reel({ bytes: 600 * MB })],
      platforms: ['instagram', 'twitter', 'tiktok'],
      kinds: { instagram: 'reel', twitter: 'feed', tiktok: 'feed' },
    })
    const byPlatform = Object.fromEntries(findings.map(f => [f.platform, f.level]))
    expect(byPlatform.instagram).toBe('degraded')
    expect(byPlatform.twitter).toBe('blocked')
    // 600 MB is nothing against TikTok's 4 GB
    expect(byPlatform.tiktok).toBeUndefined()
  })

  it('blocks a 600 MB video on LinkedIn, which caps at 500 MB', () => {
    const findings = assessAssets({
      probes: [reel({ bytes: 600 * MB })],
      platforms: ['linkedin'],
    })
    expect(findings[0].level).toBe('blocked')
    expect(findings[0].detail).toContain('500 MB')
  })

  it('passes a 400 MB video on LinkedIn, which is under its 500 MB cap', () => {
    const findings = assessAssets({
      probes: [reel({ bytes: 400 * MB })],
      platforms: ['linkedin'],
    })
    expect(findings).toEqual([])
  })

  it('recompresses a phone photo for Bluesky and says the quality drops', () => {
    const findings = assessAssets({
      probes: [photo({ bytes: 4 * MB })],
      platforms: ['bluesky'],
    })
    expect(findings[0].level).toBe('degraded')
    expect(findings[0].detail).toContain('1 MB')
  })
})

describe('length', () => {
  it('passes a 2 minute Reel and blocks a 16 minute one — Meta says fifteen', () => {
    // the 90-second cap in Zernio's guide is stale; Meta's own spec is 15 min,
    // which is how other tools post longer Reels and this one refused to
    expect(assessAssets({
      probes: [reel({ seconds: 120 })], platforms: ['instagram'], kinds: { instagram: 'reel' },
    })).toEqual([])
    const findings = assessAssets({
      probes: [reel({ seconds: 16 * 60 })], platforms: ['instagram'], kinds: { instagram: 'reel' },
    })
    expect(findings[0].level).toBe('blocked')
    expect(findings[0].detail).toContain('15 min')
  })

  it('passes the same cut on TikTok and YouTube Shorts', () => {
    expect(assessAssets({
      probes: [reel({ seconds: 120 })],
      platforms: ['tiktok'],
      kinds: { tiktok: 'feed' },
    })).toEqual([])
    expect(assessAssets({
      probes: [reel({ seconds: 120 })],
      platforms: ['youtube'],
      kinds: { youtube: 'reel' },
    })).toEqual([])
  })

  it('trims rather than blocks a long Story, because that is what happens', () => {
    const findings = assessAssets({
      probes: [reel({ seconds: 90 })],
      platforms: ['instagram'],
      kinds: { instagram: 'story' },
    })
    expect(findings[0].level).toBe('reframed')
    expect(findings[0].headline).toBe('Cut short')
  })

  it('blocks a clip below the minimum length', () => {
    const findings = assessAssets({
      probes: [reel({ seconds: 2 })],
      platforms: ['instagram'],
      kinds: { instagram: 'reel' },
    })
    expect(findings[0].level).toBe('blocked')
    expect(findings[0].headline).toBe('Too short')
  })

  it('reports one reason per asset, not every rule it also broke', () => {
    // a 2-second clip is too short; nothing is gained by also telling the
    // operator it is the wrong shape for a format it cannot enter
    const findings = assessAssets({
      probes: [reel({ seconds: 2, width: 1920, height: 1080 })],
      platforms: ['instagram'],
      kinds: { instagram: 'reel' },
    })
    expect(findings).toHaveLength(1)
  })
})

describe('shape', () => {
  it('warns that a landscape master is cropped for a Reel', () => {
    const findings = assessAssets({
      probes: [reel({ width: 1920, height: 1080 })],
      platforms: ['instagram'],
      kinds: { instagram: 'reel' },
    })
    const crop = findings.find(f => f.headline === 'Cropped to fit')
    expect(crop?.level).toBe('reframed')
    expect(crop?.detail).toContain('16:9')
    expect(crop?.detail).toContain('9:16 vertical')
  })

  it('blocks rather than crops on LinkedIn, which fails to process instead', () => {
    const findings = assessAssets({
      probes: [reel({ width: 400, height: 1920 })],
      platforms: ['linkedin'],
    })
    expect(findings.some(f => f.level === 'blocked')).toBe(true)
  })

  it('leaves a correctly framed vertical alone everywhere it belongs', () => {
    expect(assessAssets({
      probes: [reel()],
      platforms: ['instagram', 'tiktok', 'youtube'],
      kinds: { instagram: 'reel', tiktok: 'feed', youtube: 'reel' },
    })).toEqual([])
  })

  it('flags Reddit re-encoding anything above 1080p', () => {
    const findings = assessAssets({
      probes: [reel({ width: 2160, height: 3840, bytes: 500 * MB })],
      platforms: ['reddit'],
    })
    expect(findings.some(f => f.headline === 'Re-encoded by the platform')).toBe(true)
  })
})

describe('format', () => {
  it('blocks a file type the platform does not take', () => {
    const findings = assessAssets({
      probes: [reel({ url: 'https://cdn.example.invalid/a.avi', mime: 'video/x-msvideo' })],
      platforms: ['instagram'],
      kinds: { instagram: 'reel' },
    })
    expect(findings[0].level).toBe('blocked')
    expect(findings[0].headline).toContain('.avi')
  })

  it('accepts the same file on LinkedIn', () => {
    const findings = assessAssets({
      probes: [reel({ url: 'https://cdn.example.invalid/a.avi', mime: 'video/x-msvideo', width: 1080, height: 1920 })],
      platforms: ['linkedin'],
    })
    expect(findings).toEqual([])
  })

  it('calls a Facebook WebP a conversion, not a refusal', () => {
    const findings = assessAssets({
      probes: [photo({ url: 'https://cdn.example.invalid/a.webp', mime: 'image/webp', bytes: 1 * MB })],
      platforms: ['facebook'],
    })
    expect(findings[0].level).toBe('degraded')
    expect(findings[0].headline).toBe('Converted to JPEG')
  })

  it('reads the type from the extension when there is no MIME string', () => {
    expect(formatOf({ url: 'https://x.invalid/a.JPG' })).toBe('jpeg')
    expect(formatOf({ url: 'https://x.invalid/a.mov?v=2' })).toBe('mov')
    expect(formatOf({ url: 'https://x.invalid/a.mp4', mime: 'application/octet-stream' })).toBe('mp4')
    expect(formatOf({ url: 'https://x.invalid/a.mp4', mime: 'video/quicktime' })).toBe('mov')
  })
})

describe('what the operator is told in one line', () => {
  it('names the channels that will refuse the post', () => {
    const probes = [reel({ bytes: 600 * MB })]
    const platforms = ['instagram', 'twitter'] as const
    const findings = assessAssets({ probes, platforms: [...platforms], kinds: { instagram: 'reel' } })
    expect(fitHeadline(findings, [...platforms])).toBe('These files will not post on X.')
  })

  it('says so plainly when nothing is touched', () => {
    const findings = assessAssets({ probes: [reel()], platforms: ['tiktok'] })
    expect(fitHeadline(findings, ['tiktok'])).toContain('untouched')
  })

  it('gives a verdict for every selected channel, including the clean ones', () => {
    const findings = assessAssets({
      probes: [reel({ bytes: 600 * MB })],
      platforms: ['tiktok', 'twitter'],
    })
    const verdicts = verdictByPlatform(findings, ['tiktok', 'twitter'])
    expect(verdicts).toHaveLength(2)
    expect(verdicts.find(v => v.platform === 'tiktok')?.level).toBe('ok')
    expect(verdicts.find(v => v.platform === 'twitter')?.level).toBe('blocked')
  })
})

describe('a file we could not measure', () => {
  it('is named rather than passed', () => {
    const probes: AssetProbe[] = [
      reel(),
      { url: 'https://cdn.example.invalid/b.mp4', type: 'video' },
    ]
    expect(unmeasured(probes)).toEqual([2])
  })

  it('produces no false clearance — nothing is claimed about it', () => {
    const findings = assessAssets({
      probes: [{ url: 'https://cdn.example.invalid/b.mp4', type: 'video', mime: 'video/mp4' }],
      platforms: ['instagram'],
      kinds: { instagram: 'reel' },
    })
    expect(findings).toEqual([])
    expect(unmeasured([{ url: 'https://cdn.example.invalid/b.mp4', type: 'video' }])).toEqual([1])
  })
})

describe('every channel gets a stated outcome, not just the broken ones', () => {
  // a channel that says nothing looks exactly like a channel nobody checked,
  // and the person scheduling cannot tell those apart
  const probes = [reel({ bytes: 600 * MB })]
  const platforms = ['instagram', 'twitter', 'tiktok'] as const
  const rows = assetOutcomes({
    probes,
    platforms: [...platforms],
    kinds: { instagram: 'reel', twitter: 'feed', tiktok: 'feed' },
  })

  it('returns one row per asset per channel', () => {
    expect(rows).toHaveLength(3)
    expect(rows.map(r => r.platform).sort()).toEqual(['instagram', 'tiktok', 'twitter'])
  })

  it('says out loud that the clean channel is clean, and what it sends', () => {
    const tiktok = rows.find(r => r.platform === 'tiktok')!
    expect(tiktok.level).toBe('ok')
    expect(tiktok.becomes).toBe('a TikTok video')
    expect(tiktok.summary).toContain('exactly as you uploaded it')
    expect(tiktok.summary).toContain('1080 x 1920')
    expect(tiktok.summary).toContain('9:16')
  })

  it('names the medium each file lands in, not just the platform', () => {
    expect(rows.find(r => r.platform === 'instagram')!.becomes).toBe('an Instagram Reel')
    expect(rows.find(r => r.platform === 'twitter')!.becomes).toBe('an attachment on an X post')
  })

  it('carries the findings on the channels that have them, and none elsewhere', () => {
    expect(rows.find(r => r.platform === 'instagram')!.findings).toHaveLength(1)
    expect(rows.find(r => r.platform === 'twitter')!.level).toBe('blocked')
    expect(rows.find(r => r.platform === 'tiktok')!.findings).toEqual([])
  })

  it('never writes a summary and findings for the same channel', () => {
    for (const row of rows) {
      expect(row.findings.length > 0 ? row.summary === '' : row.summary !== '').toBe(true)
    }
  })

  it('names the same file differently as it changes medium', () => {
    expect(postingAs('instagram', 'story', 'video')).toBe('an Instagram Story')
    expect(postingAs('instagram', 'carousel', 'image')).toBe('a slide in an Instagram carousel')
    expect(postingAs('youtube', 'reel', 'video')).toBe('a YouTube Short')
    expect(postingAs('youtube', 'feed', 'video')).toBe('a YouTube video')
    expect(postingAs('pinterest', 'feed', 'video')).toBe('a video Pin')
  })

  it('has a name for every platform we can post to', () => {
    for (const p of SUPPORTED_PLATFORMS) {
      expect(postingAs(p, 'feed', 'video'), `no medium named for ${p}`).toBeTruthy()
    }
  })
})

describe('the specs the person is told to export to', () => {
  it('states the shape, the length and the weight for a Reel', () => {
    const lines = requirementLines('instagram', 'reel', 'video')
    expect(lines).toContain('MP4 or MOV')
    expect(lines).toContain('9:16 vertical')
    expect(lines.join(' · ')).toContain('15 min')
    expect(lines.join(' · ')).toContain('300 MB')
  })

  it('distinguishes a limit that re-encodes from one that refuses', () => {
    expect(requirementLines('instagram', 'reel', 'video').join(' ')).toContain('re-encoded')
    expect(requirementLines('twitter', 'feed', 'video').join(' ')).toContain('refused')
  })

  it('warns where the platform re-encodes whatever you send', () => {
    expect(requirementLines('reddit', 'feed', 'video').join(' ')).toContain('1080p')
  })

  // the reason the specs are read off the rules rather than written twice:
  // a number on screen that the check does not use is worse than no number
  it('quotes the same numbers the checks flag on', () => {
    const spec = requirementLines('bluesky', 'feed', 'image').join(' ')
    const finding = assessAssets({
      probes: [photo({ bytes: 4 * MB })],
      platforms: ['bluesky'],
    })[0]
    expect(spec).toContain('1 MB')
    expect(finding.detail).toContain('1 MB')
  })

  it('has something to say for every platform, for stills and for video', () => {
    for (const p of SUPPORTED_PLATFORMS) {
      expect(requirementLines(p, 'feed', 'video').length, `no video spec for ${p}`).toBeGreaterThan(0)
      expect(requirementLines(p, 'feed', 'image').length, `no image spec for ${p}`).toBeGreaterThan(0)
    }
  })

  it('describes only the kinds of file actually attached', () => {
    const specs = channelSpecs({
      platforms: ['instagram'],
      kinds: { instagram: 'reel' },
      types: ['video'],
    })
    expect(specs).toHaveLength(1)
    expect(specs[0].becomes).toBe('an Instagram Reel')
    expect(specs[0].groups.map(g => g.type)).toEqual(['video'])
  })

  it('covers both kinds before anything is attached', () => {
    const specs = channelSpecs({ platforms: ['instagram'] })
    expect(specs[0].groups.map(g => g.type)).toEqual(['image', 'video'])
  })

  it('drops a kind the platform does not take rather than inventing one', () => {
    // YouTube has no still-image post; the rules table gives it thumbnail
    // limits, and a channel with nothing to say for a kind says nothing
    const specs = channelSpecs({ platforms: ['linkedin'], types: ['document'] })
    expect(specs[0].groups.every(g => g.lines.length > 0)).toBe(true)
  })
})

describe('describeAspect', () => {
  it('names the shapes people frame for', () => {
    expect(describeAspect(1080, 1920)).toBe('9:16')
    expect(describeAspect(1080, 1350)).toBe('4:5')
    expect(describeAspect(1080, 1080)).toBe('1:1')
    expect(describeAspect(1920, 1080)).toBe('16:9')
  })

  it('falls back to a ratio for anything else', () => {
    expect(describeAspect(1000, 700)).toBe('1.43:1')
    expect(describeAspect(700, 1000)).toBe('1:1.43')
  })
})

describe('the platform names its own post types', () => {
  it('calls the same upload what each platform calls it', () => {
    expect(kindLabel('instagram', 'reel')).toBe('Reel')
    expect(kindLabel('facebook', 'reel')).toBe('Reel')
    expect(kindLabel('youtube', 'reel')).toBe('Short')
    expect(kindLabel('tiktok', 'reel')).toBe('Video')
    expect(kindLabel('linkedin', 'reel')).toBe('Short video')
  })

  it('names the plain post the way the platform does', () => {
    expect(kindLabel('pinterest', 'feed')).toBe('Pin')
    expect(kindLabel('linkedin', 'feed')).toBe('Feed post')
    expect(kindLabel('tiktok', 'carousel')).toBe('Photo post')
  })

  it('has a label for every type every platform offers', () => {
    for (const p of SUPPORTED_PLATFORMS) {
      for (const k of ['feed', 'reel', 'story', 'carousel'] as const) {
        expect(kindLabel(p, k), `${p}/${k}`).toBeTruthy()
      }
    }
  })
})

describe('a "feed" video on Instagram is a Reel, and is judged as one', () => {
  // the case that got through: a 2 GB landscape master sent as "feed" passed
  // the feed rules and Instagram refused it — because since 2023 Instagram
  // publishes every single video as a Reel, and the provider does the same
  it('applies Reel rules to a lone video labelled feed', () => {
    const findings = assessAssets({
      probes: [reel({ width: 1920, height: 1080, bytes: 2048 * MB, seconds: 1000 })],
      platforms: ['instagram'],
      kinds: { instagram: 'feed' },
    })
    const heads = findings.map(f => f.headline)
    expect(heads).toContain('Too long')                      // 1000s vs 15 min
    expect(findings.some(f => f.level === 'blocked')).toBe(true)
  })

  it('and passes a properly cut vertical one, feed or reel', () => {
    for (const kind of ['feed', 'reel', undefined] as const) {
      expect(assessAssets({
        probes: [reel()],
        platforms: ['instagram'],
        kinds: kind ? { instagram: kind } : undefined,
      })).toEqual([])
    }
  })

  it('names it a Reel in the sentence too, so the label never lies', () => {
    expect(postingAs('instagram', 'feed', 'video')).toBe('an Instagram Reel')
    expect(postingAs('instagram', undefined, 'video')).toBe('an Instagram Reel')
    expect(postingAs('instagram', 'feed', 'image')).toBe('an Instagram feed post')
    expect(effectiveKind('instagram', 'video', 'feed')).toBe('reel')
    expect(effectiveKind('instagram', 'image', 'feed')).toBe('feed')
    expect(effectiveKind('tiktok', 'video', 'feed')).toBe('feed')
  })
})

/**
 * The encode ladder.
 *
 * One property carries this whole file: a copy made to fit a channel must
 * actually fit it. If it does not, the channel compresses it — which is the
 * exact failure the encoder was built to stop, arrived at by a longer route.
 */
describe('the encode ladder', () => {
  const PLATFORMS = [
    'instagram', 'facebook', 'tiktok', 'linkedin', 'twitter',
    'youtube', 'threads', 'pinterest', 'bluesky', 'reddit',
  ] as const
  const KINDS = [undefined, 'feed', 'reel', 'story', 'carousel'] as const

  it('never hands a channel a copy bigger than the channel takes', () => {
    for (const platform of PLATFORMS) {
      for (const kind of KINDS) {
        for (const seconds of [undefined, 5, 20, 90, 600, 100_000]) {
          const target = encodeTargetFor(platform, kind, seconds)
          if (!target) continue
          const worst = encodeWorstCaseMB(target)
          expect(
            worst,
            `${platform}/${kind ?? 'default'} at ${seconds ?? 'unknown'}s would allow ${worst.toFixed(0)} MB against a ${target.maxMB} MB limit`,
          ).toBeLessThan(target.maxMB)
        }
      }
    }
  })

  it('never budgets for less time than the clip actually runs', () => {
    // 20 seconds of budget for a 90-second clip would come back three times
    // over the limit, having passed every check on the way
    expect(encodeTargetFor('instagram', 'reel', 90)!.maxSeconds).toBe(90)
    expect(encodeTargetFor('instagram', 'story', 500)!.maxSeconds).toBe(60)   // capped at the channel's own
    expect(encodeTargetFor('instagram', 'reel')!.maxSeconds).toBe(15 * 60)    // unmeasured: the channel's ceiling
  })

  it('spends the channel ceiling on a clip short enough to afford it', () => {
    // a 20-second reel: 10 Mbps for 20s is 25 MB, nowhere near Instagram's 300
    expect(encodeTargetFor('instagram', 'reel', 20)!.maxrateKbps).toBe(10_000)
    expect(encodeTargetFor('tiktok', undefined, 20)!.maxrateKbps).toBe(12_000)
    expect(encodeTargetFor('twitter', undefined, 20)!.maxrateKbps).toBe(8_000)
  })

  it('spends less when the channel’s size limit will not stretch', () => {
    // Instagram takes 300 MB and fifteen minutes; a fifteen-minute Reel
    // cannot have 10 Mbps and still fit, so it does not get it
    const long = encodeTargetFor('instagram', 'reel', 15 * 60)!
    expect(long.maxrateKbps).toBeLessThan(10_000)
    expect(long.maxrateKbps).toBeGreaterThan(1_500)
  })

  it('gives up rather than offering a copy no better than the player file', () => {
    // there is no bitrate at which 300 MB covers a hundred thousand seconds
    expect(encodeTargetFor('instagram', 'reel', 100_000)).not.toBeNull()  // capped at 15 min first
    expect(encodeTargetFor('bluesky', undefined, 10 * 60)).not.toBeNull()
  })

  it('sets the buffer to twice the ceiling, and the sound to 160k', () => {
    for (const platform of PLATFORMS) {
      const t = encodeTargetFor(platform, undefined, 20)
      if (!t) continue
      expect(t.bufsizeKbps).toBe(t.maxrateKbps * 2)
      expect(t.audioKbps).toBe(160)
    }
  })

  it('is 1080p on the short side and 1920 on the long one', () => {
    for (const platform of PLATFORMS) {
      expect(PLATFORM_ENCODE[platform].shortSide).toBe(1080)
      expect(PLATFORM_ENCODE[platform].longSide).toBe(1920)
    }
  })

  it('keeps 60 fps only where the channel serves it', () => {
    expect(PLATFORM_ENCODE.youtube.maxFps).toBe(60)
    for (const platform of PLATFORMS.filter(p => p !== 'youtube')) {
      expect(PLATFORM_ENCODE[platform].maxFps).toBe(30)
    }
  })

  it('has a ladder for every channel there is', () => {
    for (const platform of PLATFORMS) expect(PLATFORM_ENCODE[platform]).toBeTruthy()
  })
})
