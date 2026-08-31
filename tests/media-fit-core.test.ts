import { describe, it, expect } from 'vitest'
import {
  assessAssets, assetOutcomes, channelSpecs, describeAspect, fitHeadline, formatOf,
  postingAs, requirementLines, unmeasured, verdictByPlatform, PLATFORM_MEDIA,
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
  it('blocks a 2 minute cut as an Instagram Reel', () => {
    const findings = assessAssets({
      probes: [reel({ seconds: 120 })],
      platforms: ['instagram'],
      kinds: { instagram: 'reel' },
    })
    expect(findings[0].level).toBe('blocked')
    expect(findings[0].detail).toContain('90s')
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
    expect(lines.join(' · ')).toContain('90s')
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
