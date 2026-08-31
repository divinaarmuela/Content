/**
 * Will this file survive the trip to each platform?
 *
 * `publish-core.ts` answers "is this post legal" from counts and caption
 * length alone — how many images, how many videos, how long the words are.
 * It cannot see the file, so it says nothing about the three things that
 * actually ruin a post: a video that gets re-encoded into mush, a clip that
 * gets cropped to a shape nobody framed for, and a file the platform simply
 * refuses.
 *
 * This module sees the file. Given the size, dimensions and duration the
 * browser reads off an asset before it is scheduled, it says — per asset, per
 * platform — exactly one of four things:
 *
 *   ok        nothing happens to it
 *   reframed  it posts, but cropped or cut to a different shape or length
 *   degraded  it posts, but re-encoded — visibly worse than the master
 *   blocked   it does not post at all
 *
 * Every number below comes from Zernio's platform guides (docs.zernio.com/
 * platforms/<name>), which is the provider that will actually carry the post.
 * Where the docs say a limit is enforced by compression rather than rejection
 * — Instagram, Threads and Bluesky all quietly recompress — that is recorded
 * as `oversize: 'compress'`, because the post succeeding is not the same as
 * the post being right. An Instagram video over 300 MB is the case that
 * proves it: it publishes, with no error anywhere, having been re-encoded.
 */

import type { MediaType, Platform, PostKind } from './publish-core'

/** What the browser could read off the file before it was uploaded.
 *
 *  Every measurement is optional: an asset added by URL, or a codec the
 *  browser will not decode, gives us nothing. Missing is reported as unknown,
 *  never as fine — a silent pass on a file we never measured is the failure
 *  this module exists to prevent. */
export type AssetProbe = {
  url: string
  type: MediaType
  /** the browser's own type string, e.g. `video/quicktime` */
  mime?: string
  bytes?: number
  width?: number
  height?: number
  seconds?: number
}

export type FitLevel = 'ok' | 'reframed' | 'degraded' | 'blocked'

/** One thing that will happen to one asset on one platform. */
export type Finding = {
  platform: Platform
  /** 1-based, matching what the person sees in the media strip */
  asset: number
  level: Exclude<FitLevel, 'ok'>
  /** the short label, e.g. "Re-encoded — quality drops" */
  headline: string
  /** the numbers behind it, e.g. "12 MB; Bluesky allows 1 MB" */
  detail: string
  /** what happens if it is posted anyway */
  consequence: string
}

const MB = 1024 * 1024

type Rule = {
  /** file kinds the platform takes, normalised (jpeg, png, webp, gif, mp4, mov, …) */
  formats: string[]
  /** formats accepted only by being converted first — not a refusal, a change */
  converts?: Record<string, string>
  maxMB?: number
  /** what happens past `maxMB`: the provider recompresses, or the post fails */
  oversize?: 'compress' | 'reject'
  minSeconds?: number
  maxSeconds?: number
  /** past `maxSeconds`: cut short, or refused outright */
  overlong?: 'trim' | 'reject'
  minWidth?: number
  minHeight?: number
  maxWidth?: number
  maxHeight?: number
  /** width ÷ height the platform shows uncropped */
  aspectMin?: number
  aspectMax?: number
  /** outside the aspect range this platform fails rather than crops */
  aspectIsHard?: boolean
  /** the platform re-encodes anything taller than this, always */
  transcodeAboveHeight?: number
  /** the shape the format is designed around, named for the message */
  aspectName?: string
}

type PlatformMedia = {
  label: string
  image: Rule
  video: Rule
  document?: Rule
  /** rules that replace the defaults for a particular kind of post */
  byKind?: Partial<Record<PostKind, { image?: Partial<Rule>; video?: Partial<Rule> }>>
}

/** The named shapes, as plain numbers, so the ranges below read as ratios. */
const PORTRAIT_MIN = 0.8         // 4:5
const LANDSCAPE_MAX = 1.91

/** A 9:16 export is never exactly 0.5625 after a round-trip through an
 *  editor, so allow a hair either side before calling a clip the wrong shape. */
const VERTICAL_MIN = 0.55
const VERTICAL_MAX = 0.58

export const PLATFORM_MEDIA: Record<Platform, PlatformMedia> = {
  instagram: {
    label: 'Instagram',
    image: {
      formats: ['jpeg', 'png'],
      maxMB: 8, oversize: 'compress',
      aspectMin: PORTRAIT_MIN, aspectMax: LANDSCAPE_MAX,
    },
    video: {
      formats: ['mp4', 'mov'],
      // over 300 MB Instagram does not refuse the post — it compresses it
      maxMB: 300, oversize: 'compress',
      minSeconds: 3, maxSeconds: 60 * 60, overlong: 'reject',
      aspectMin: PORTRAIT_MIN, aspectMax: LANDSCAPE_MAX,
      minWidth: 540,
    },
    byKind: {
      reel: {
        video: {
          maxMB: 300, oversize: 'compress',
          maxSeconds: 90, overlong: 'reject',
          aspectMin: VERTICAL_MIN, aspectMax: VERTICAL_MAX, aspectName: '9:16 vertical',
          minWidth: 1080,
        },
      },
      story: {
        image: { maxMB: 8, aspectMin: VERTICAL_MIN, aspectMax: VERTICAL_MAX, aspectName: '9:16 vertical' },
        video: {
          maxMB: 100, oversize: 'compress',
          maxSeconds: 60, overlong: 'trim',
          aspectMin: VERTICAL_MIN, aspectMax: VERTICAL_MAX, aspectName: '9:16 vertical',
        },
      },
    },
  },

  tiktok: {
    label: 'TikTok',
    image: {
      formats: ['jpeg', 'png', 'webp'],
      maxMB: 20, oversize: 'reject',
      // TikTok resizes every still to 1080 x 1920 whatever you send it
      aspectMin: VERTICAL_MIN, aspectMax: VERTICAL_MAX, aspectName: '9:16 vertical',
    },
    video: {
      formats: ['mp4', 'mov', 'webm'],
      maxMB: 4096, oversize: 'reject',
      minSeconds: 3, maxSeconds: 10 * 60, overlong: 'reject',
      aspectMin: VERTICAL_MIN, aspectMax: VERTICAL_MAX, aspectName: '9:16 vertical',
    },
  },

  twitter: {
    label: 'X',
    image: { formats: ['jpeg', 'png', 'webp', 'gif'], maxMB: 5, oversize: 'reject' },
    video: {
      formats: ['mp4', 'mov'],
      maxMB: 512, oversize: 'reject',
      maxSeconds: 140, overlong: 'reject',
    },
  },

  linkedin: {
    label: 'LinkedIn',
    image: {
      formats: ['jpeg', 'png', 'gif'],
      maxMB: 8, oversize: 'reject',
      minWidth: 552, minHeight: 276, maxWidth: 8192, maxHeight: 8192,
    },
    video: {
      formats: ['mp4', 'mov', 'avi'],
      maxMB: 5120, oversize: 'reject',
      minSeconds: 3, maxSeconds: 10 * 60, overlong: 'reject',
      minWidth: 256, minHeight: 144, maxWidth: 4096, maxHeight: 2304,
      // LinkedIn does not crop to fit; a shape outside this fails to process
      aspectMin: 1 / 2.4, aspectMax: 2.4, aspectIsHard: true,
    },
    document: { formats: ['pdf'], maxMB: 100, oversize: 'reject' },
  },

  facebook: {
    label: 'Facebook',
    image: {
      formats: ['jpeg', 'png', 'gif'],
      converts: { webp: 'JPEG' },
      // the stated limit is higher, but Facebook rejects stills over 4 MB
      maxMB: 4, oversize: 'reject',
    },
    video: {
      formats: ['mp4', 'mov'],
      maxMB: 4096, oversize: 'reject',
      minSeconds: 1, maxSeconds: 240 * 60, overlong: 'reject',
      minWidth: 1280, minHeight: 720,
    },
    byKind: {
      reel: {
        video: {
          minSeconds: 3, maxSeconds: 60, overlong: 'reject',
          aspectMin: VERTICAL_MIN, aspectMax: VERTICAL_MAX, aspectName: '9:16 vertical',
        },
      },
      story: {
        video: {
          maxSeconds: 120, overlong: 'reject',
          aspectMin: VERTICAL_MIN, aspectMax: VERTICAL_MAX, aspectName: '9:16 vertical',
        },
        image: { aspectMin: VERTICAL_MIN, aspectMax: VERTICAL_MAX, aspectName: '9:16 vertical' },
      },
    },
  },

  threads: {
    label: 'Threads',
    image: {
      formats: ['jpeg', 'png'],
      // WebP is listed but reported unreliable — a conversion, not a refusal
      converts: { webp: 'JPEG' },
      maxMB: 8, oversize: 'compress',
    },
    video: {
      formats: ['mp4'],
      maxMB: 1024, oversize: 'reject',
      maxSeconds: 5 * 60, overlong: 'reject',
    },
  },

  youtube: {
    label: 'YouTube',
    image: { formats: ['jpeg', 'png', 'gif'], maxMB: 2, oversize: 'reject' },
    video: {
      formats: ['mp4', 'mov', 'avi', 'webm'],
      maxMB: 256 * 1024, oversize: 'reject',
      // 15 minutes is the cap until the channel is phone-verified
      minSeconds: 1, maxSeconds: 15 * 60, overlong: 'reject',
    },
    byKind: {
      reel: {
        video: {
          maxSeconds: 180, overlong: 'reject',
          aspectMin: VERTICAL_MIN, aspectMax: VERTICAL_MAX, aspectName: '9:16 vertical',
        },
      },
    },
  },

  pinterest: {
    label: 'Pinterest',
    image: {
      formats: ['jpeg', 'png', 'webp', 'gif'],
      maxMB: 32, oversize: 'reject', minWidth: 100, minHeight: 100,
    },
    video: {
      formats: ['mp4', 'mov'],
      maxMB: 2048, oversize: 'reject',
      minSeconds: 4, maxSeconds: 15 * 60, overlong: 'reject',
      minHeight: 240,
      aspectMin: VERTICAL_MIN, aspectMax: 1, aspectName: '2:3 or taller',
    },
  },

  bluesky: {
    label: 'Bluesky',
    image: {
      formats: ['jpeg', 'png', 'webp', 'gif'],
      // 1 MB is a hard blob limit; Zernio recompresses to fit, and says so
      maxMB: 1, oversize: 'compress',
      maxWidth: 2000, maxHeight: 2000,
    },
    video: {
      formats: ['mp4'],
      maxMB: 50, oversize: 'reject',
      maxSeconds: 60, overlong: 'reject',
      maxWidth: 1920, maxHeight: 1080,
    },
  },

  reddit: {
    label: 'Reddit',
    image: { formats: ['jpeg', 'png', 'gif'], maxMB: 20, oversize: 'reject' },
    video: {
      formats: ['mp4', 'mov'],
      maxMB: 1024, oversize: 'reject',
      // Reddit re-encodes every upload and will not serve above 1080p30
      transcodeAboveHeight: 1080,
    },
  },
}

/** Name the file kind the way the rules table does.
 *
 *  The type string is trusted first because it comes from the operating
 *  system; the extension is the fallback for an asset that arrived as a bare
 *  URL. `image/jpg` is not a real type but browsers emit it, and a `.mov`
 *  reports itself as `video/quicktime`. */
export function formatOf(probe: { url: string; mime?: string }): string | null {
  const sub = probe.mime?.toLowerCase().split('/')[1]?.split(';')[0]?.trim()
  const ext = probe.url.toLowerCase().split(/[?#]/)[0].split('.').pop()
  const raw = sub && sub !== 'octet-stream' ? sub : ext
  if (!raw) return null
  const alias: Record<string, string> = {
    jpg: 'jpeg', quicktime: 'mov', 'x-msvideo': 'avi',
    'x-matroska': 'mkv', 'x-m4v': 'mp4', m4v: 'mp4', heif: 'heic',
  }
  return alias[raw] ?? raw
}

/** "9:16", "4:5", or "1.34:1" when it is not one of the named shapes. */
export function describeAspect(width: number, height: number): string {
  const named: [number, string][] = [
    [9 / 16, '9:16'], [2 / 3, '2:3'], [3 / 4, '3:4'], [4 / 5, '4:5'],
    [1, '1:1'], [4 / 3, '4:3'], [16 / 9, '16:9'], [1.91, '1.91:1'],
  ]
  const ratio = width / height
  for (const [value, label] of named) {
    if (Math.abs(ratio - value) < 0.02) return label
  }
  return ratio >= 1 ? `${ratio.toFixed(2)}:1` : `1:${(1 / ratio).toFixed(2)}`
}

function mb(bytes: number): string {
  const value = bytes / MB
  if (value >= 1024) return `${(value / 1024).toFixed(1)} GB`
  return value >= 10 ? `${Math.round(value)} MB` : `${value.toFixed(1)} MB`
}

function limitMB(value: number): string {
  return value >= 1024 ? `${Math.round(value / 1024)} GB` : `${value} MB`
}

function secs(value: number): string {
  // creators talk about a Reel as "90 seconds", never as "1m 30s" — keep
  // anything short enough to be a vertical format in seconds
  if (value < 120) return `${Math.round(value)}s`
  const m = Math.floor(value / 60)
  const s = Math.round(value % 60)
  return s ? `${m}m ${s}s` : `${m} min`
}

/** Merge a kind's overrides over the platform's ordinary rules. */
function ruleFor(platform: Platform, type: MediaType, kind: PostKind | undefined): Rule | null {
  const spec = PLATFORM_MEDIA[platform]
  if (!spec) return null
  const base =
    type === 'image' ? spec.image
    : type === 'video' ? spec.video
    : spec.document
  if (!base) return null
  // a carousel is still a feed asset; only Reels and Stories change the rules
  const override = kind && kind !== 'feed' && kind !== 'carousel'
    ? spec.byKind?.[kind]?.[type === 'video' ? 'video' : 'image']
    : undefined
  return override ? { ...base, ...override } : base
}

function kindWord(kind: PostKind | undefined): string {
  if (kind === 'reel') return ' Reels'
  if (kind === 'story') return ' Stories'
  return ''
}

/**
 * Everything that will happen to these assets on these platforms.
 *
 * Sorted worst-first within each asset, so the panel that renders this leads
 * with the thing that stops the post rather than the thing that trims it.
 */
export function assessAssets(input: {
  probes: AssetProbe[]
  platforms: Platform[]
  kinds?: Partial<Record<Platform, PostKind>>
}): Finding[] {
  const findings: Finding[] = []

  input.probes.forEach((probe, i) => {
    const asset = i + 1
    const format = formatOf(probe)

    for (const platform of input.platforms) {
      const spec = PLATFORM_MEDIA[platform]
      if (!spec) continue
      const kind = input.kinds?.[platform]
      const rule = ruleFor(platform, probe.type, kind)
      const push = (f: Omit<Finding, 'platform' | 'asset'>) =>
        findings.push({ platform, asset, ...f })

      if (!rule) {
        push({
          level: 'blocked',
          headline: `${spec.label} does not take this kind of file`,
          detail: `${probe.type} attachments are not supported there`,
          consequence: 'The post is refused. Remove the file, or drop this channel.',
        })
        continue
      }

      // ── format ────────────────────────────────────────────────────
      if (format) {
        const converted = rule.converts?.[format]
        if (converted) {
          push({
            level: 'degraded',
            headline: `Converted to ${converted}`,
            detail: `${spec.label} does not display .${format} and re-saves it as ${converted}`,
            consequence:
              `It posts, but through a second encode. Export ${converted} yourself ` +
              'to keep the quality you graded.',
          })
        } else if (!rule.formats.includes(format)) {
          push({
            level: 'blocked',
            headline: `.${format} is not accepted`,
            detail: `${spec.label} takes ${rule.formats.map(f => `.${f}`).join(', ')}`,
            consequence: 'This fails at publish time, not now — re-export before scheduling.',
          })
          continue
        }
      }

      // ── file size ─────────────────────────────────────────────────
      if (probe.bytes !== undefined && rule.maxMB !== undefined && probe.bytes > rule.maxMB * MB) {
        if (rule.oversize === 'compress') {
          push({
            level: 'degraded',
            headline: 'Re-encoded — quality will drop',
            detail: `${mb(probe.bytes)}; ${spec.label}${kindWord(kind)} allows ${limitMB(rule.maxMB)}, so it is compressed to fit`,
            consequence:
              'It posts and nothing errors — it simply looks softer than the file you approved. ' +
              `Export under ${limitMB(rule.maxMB)} to control where that loss lands.`,
          })
        } else {
          push({
            level: 'blocked',
            headline: 'Too large to post',
            detail: `${mb(probe.bytes)}; ${spec.label} allows ${limitMB(rule.maxMB)}`,
            consequence: 'The platform refuses it. Nothing goes live on this channel.',
          })
          continue
        }
      }

      // ── duration ──────────────────────────────────────────────────
      if (probe.seconds !== undefined && probe.type === 'video') {
        if (rule.minSeconds !== undefined && probe.seconds < rule.minSeconds) {
          push({
            level: 'blocked',
            headline: 'Too short',
            detail: `${secs(probe.seconds)}; ${spec.label} needs at least ${secs(rule.minSeconds)}`,
            consequence: 'The platform refuses it. Hold the last frame, or add a beat at the top.',
          })
          continue
        }
        if (rule.maxSeconds !== undefined && probe.seconds > rule.maxSeconds) {
          if (rule.overlong === 'trim') {
            push({
              level: 'reframed',
              headline: 'Cut short',
              detail: `${secs(probe.seconds)}; only the first ${secs(rule.maxSeconds)} is used`,
              consequence: 'It posts, but the ending never plays. Cut a version that lands inside the limit.',
            })
          } else {
            push({
              level: 'blocked',
              headline: 'Too long',
              detail: `${secs(probe.seconds)}; ${spec.label}${kindWord(kind)} allows ${secs(rule.maxSeconds)}`,
              consequence: 'The platform refuses it. Nothing goes live on this channel.',
            })
            continue
          }
        }
      }

      // ── shape and resolution ──────────────────────────────────────
      if (probe.width && probe.height) {
        const ratio = probe.width / probe.height
        const shape = describeAspect(probe.width, probe.height)

        if (rule.aspectMin !== undefined && rule.aspectMax !== undefined
            && (ratio < rule.aspectMin - 0.001 || ratio > rule.aspectMax + 0.001)) {
          if (rule.aspectIsHard) {
            push({
              level: 'blocked',
              headline: `${shape} is outside the shapes ${spec.label} accepts`,
              detail: `${spec.label} takes between 1:2.4 and 2.4:1`,
              consequence: 'The upload fails while processing — it never appears at all.',
            })
          } else {
            push({
              level: 'reframed',
              headline: 'Cropped to fit',
              detail: rule.aspectName
                ? `${shape}; ${spec.label}${kindWord(kind)} shows ${rule.aspectName}`
                : `${shape}; ${spec.label} shows between 4:5 and 1.91:1`,
              consequence:
                'It posts, but the edges are cut off or bars are added. Anything near the frame ' +
                'edge — a logo, a caption, a face — may not survive.',
            })
          }
        }

        if (rule.minWidth && probe.width < rule.minWidth) {
          push({
            level: probe.type === 'video' ? 'blocked' : 'degraded',
            headline: 'Below the minimum resolution',
            detail: `${probe.width} px wide; ${spec.label}${kindWord(kind)} wants at least ${rule.minWidth} px`,
            consequence: probe.type === 'video'
              ? 'The platform refuses it. Re-export at a higher resolution.'
              : 'It posts, but upscaled and soft on a phone screen.',
          })
        } else if (rule.minHeight && probe.height < rule.minHeight) {
          push({
            level: 'degraded',
            headline: 'Below the minimum resolution',
            detail: `${probe.height} px tall; ${spec.label} wants at least ${rule.minHeight} px`,
            consequence: 'It posts, but upscaled and soft on a phone screen.',
          })
        }

        if (rule.maxWidth && rule.maxHeight
            && (probe.width > rule.maxWidth || probe.height > rule.maxHeight)) {
          push({
            level: 'degraded',
            headline: 'Scaled down',
            detail: `${probe.width} x ${probe.height}; ${spec.label} caps at ${rule.maxWidth} x ${rule.maxHeight}`,
            consequence: 'It posts at the smaller size — fine detail and small type get lost.',
          })
        }

        if (rule.transcodeAboveHeight && probe.height > rule.transcodeAboveHeight) {
          push({
            level: 'degraded',
            headline: 'Re-encoded by the platform',
            detail: `${probe.height}p; ${spec.label} re-encodes anything above ${rule.transcodeAboveHeight}p 30fps`,
            consequence: 'It posts, but not at the quality you uploaded — the platform serves its own version.',
          })
        }
      }
    }
  })

  const rank: Record<Finding['level'], number> = { blocked: 0, degraded: 1, reframed: 2 }
  return findings.sort((a, b) =>
    a.asset - b.asset || rank[a.level] - rank[b.level] || a.platform.localeCompare(b.platform))
}

/** Assets we could not measure, so nothing above was checked for them.
 *  Returned 1-based, matching the numbering in `Finding.asset`. */
export function unmeasured(probes: AssetProbe[]): number[] {
  return probes
    .map((p, i) => ({ p, n: i + 1 }))
    .filter(({ p }) =>
      p.bytes === undefined
      || (p.type !== 'document' && (p.width === undefined || p.height === undefined))
      || (p.type === 'video' && p.seconds === undefined))
    .map(({ n }) => n)
}

/** The worst thing that happens on each platform — the one-line verdict that
 *  sits next to each channel: is this asset set acceptable there, or not. */
export function verdictByPlatform(
  findings: Finding[], platforms: Platform[],
): { platform: Platform; level: FitLevel; count: number }[] {
  const rank: Record<FitLevel, number> = { ok: 0, reframed: 1, degraded: 2, blocked: 3 }
  return platforms.map(platform => {
    const mine = findings.filter(f => f.platform === platform)
    const level = mine.reduce<FitLevel>(
      (worst, f) => (rank[f.level] > rank[worst] ? f.level : worst), 'ok')
    return { platform, level, count: mine.length }
  })
}

export const LEVEL_WORDS: Record<FitLevel, { label: string; meaning: string }> = {
  ok:       { label: 'Posts as-is',   meaning: 'Nothing is changed on the way out.' },
  reframed: { label: 'Cropped',       meaning: 'It posts, in a different shape or length than you gave it.' },
  degraded: { label: 'Quality drops', meaning: 'It posts, re-encoded — visibly worse than your master.' },
  blocked:  { label: 'Will not post', meaning: 'The platform refuses it. Nothing goes live on that channel.' },
}

/**
 * What this file becomes on this platform, named the way the platform names it.
 *
 * "Instagram" is not one medium — the same clip is a Reel, a Story or a feed
 * post depending on how it is sent, and each of those crops and truncates
 * differently. Saying which one it lands as is half of telling someone what
 * will happen to their file.
 */
export function postingAs(platform: Platform, kind: PostKind | undefined, type: MediaType): string {
  const video = type === 'video'
  switch (platform) {
    case 'instagram':
      return kind === 'story' ? 'an Instagram Story'
        : kind === 'reel' ? 'an Instagram Reel'
        : kind === 'carousel' ? 'a slide in an Instagram carousel'
        : video ? 'an Instagram feed video' : 'an Instagram feed post'
    case 'facebook':
      return kind === 'story' ? 'a Facebook Story'
        : kind === 'reel' ? 'a Facebook Reel'
        : kind === 'carousel' ? 'a card in a Facebook carousel'
        : 'a Facebook feed post'
    case 'tiktok':
      return video ? 'a TikTok video' : 'a slide in a TikTok photo post'
    case 'youtube':
      return kind === 'reel' ? 'a YouTube Short' : 'a YouTube video'
    case 'linkedin':
      return type === 'document' ? 'a LinkedIn document post'
        : kind === 'carousel' ? 'an image in a LinkedIn post'
        : 'a LinkedIn feed post'
    case 'twitter':
      return 'an attachment on an X post'
    case 'threads':
      return kind === 'carousel' ? 'an item in a Threads carousel' : 'a Threads post'
    case 'pinterest':
      return video ? 'a video Pin' : 'a Pin'
    case 'bluesky':
      return 'an attachment on a Bluesky post'
    case 'reddit':
      return 'a Reddit post'
  }
}

/** How the file reads back to a person: shape, length, weight. */
function delivered(probe: AssetProbe): string {
  const parts: string[] = []
  if (probe.width && probe.height) {
    parts.push(`${probe.width} x ${probe.height}`, describeAspect(probe.width, probe.height))
  }
  if (probe.seconds !== undefined) parts.push(secs(probe.seconds))
  if (probe.bytes !== undefined) parts.push(mb(probe.bytes))
  return parts.join(' · ')
}

/** "MP4, MOV or WebM" */
function orList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`
}

/**
 * What this platform wants, in the order it matters — the export brief.
 *
 * Read off the same `Rule` the check is decided by, never written out a second
 * time, so the specs on screen cannot drift from the specs enforced. A number
 * that appears here is the number that will flag the file.
 */
export function requirementLines(
  platform: Platform, kind: PostKind | undefined, type: MediaType,
): string[] {
  const rule = ruleFor(platform, type, kind)
  if (!rule) return []
  const lines: string[] = []

  lines.push(orList(rule.formats.map(f => f.toUpperCase())))

  if (rule.aspectName) {
    lines.push(rule.aspectName)
  } else if (rule.aspectMin !== undefined && rule.aspectMax !== undefined) {
    lines.push(`between ${describeRatio(rule.aspectMin)} and ${describeRatio(rule.aspectMax)}`)
  }

  if (rule.minWidth && rule.minHeight) lines.push(`at least ${rule.minWidth} x ${rule.minHeight} px`)
  else if (rule.minWidth) lines.push(`at least ${rule.minWidth} px wide`)
  else if (rule.minHeight) lines.push(`at least ${rule.minHeight} px tall`)

  if (rule.maxWidth && rule.maxHeight) lines.push(`up to ${rule.maxWidth} x ${rule.maxHeight} px`)

  if (type === 'video') {
    if (rule.minSeconds !== undefined && rule.maxSeconds !== undefined) {
      lines.push(`${secs(rule.minSeconds)} to ${secs(rule.maxSeconds)}`)
    } else if (rule.maxSeconds !== undefined) {
      lines.push(`up to ${secs(rule.maxSeconds)}${rule.overlong === 'trim' ? ' (longer is cut short)' : ''}`)
    } else if (rule.minSeconds !== undefined) {
      lines.push(`at least ${secs(rule.minSeconds)}`)
    }
  }

  if (rule.maxMB !== undefined) {
    lines.push(rule.oversize === 'compress'
      ? `under ${limitMB(rule.maxMB)} — over that it is re-encoded`
      : `under ${limitMB(rule.maxMB)} — over that it is refused`)
  }

  if (rule.transcodeAboveHeight) {
    lines.push(`re-encoded above ${rule.transcodeAboveHeight}p, whatever you send`)
  }

  return lines
}

/** A ratio as people write one: 4:5, 1.91:1. */
function describeRatio(value: number): string {
  if (Math.abs(value - 0.8) < 0.01) return '4:5'
  if (Math.abs(value - 9 / 16) < 0.01) return '9:16'
  if (Math.abs(value - 1) < 0.01) return '1:1'
  return value >= 1 ? `${value.toFixed(2)}:1` : `1:${(1 / value).toFixed(2)}`
}

/** The export brief for every selected channel, for the kinds of file in hand. */
export function channelSpecs(input: {
  platforms: Platform[]
  kinds?: Partial<Record<Platform, PostKind>>
  /** which kinds of file to describe; all of them when nothing is attached yet */
  types?: MediaType[]
}): {
  platform: Platform
  label: string
  becomes: string
  groups: { type: MediaType; lines: string[] }[]
}[] {
  const wanted = input.types?.length ? [...new Set(input.types)] : (['image', 'video'] as MediaType[])
  return input.platforms.map(platform => {
    const kind = input.kinds?.[platform]
    return {
      platform,
      label: PLATFORM_MEDIA[platform].label,
      becomes: postingAs(platform, kind, wanted.includes('video') ? 'video' : wanted[0]),
      groups: wanted
        .map(type => ({ type, lines: requirementLines(platform, kind, type) }))
        .filter(g => g.lines.length > 0),
    }
  })
}

/** One row per asset per platform — including the platforms where nothing
 *  happens to it.
 *
 *  `assessAssets` only reports trouble, which leaves a channel that is fine
 *  looking identical to a channel nobody checked. A person scheduling five
 *  channels at once needs the opposite: a stated outcome for every one of
 *  them, so silence is never something they have to interpret. */
export type AssetOutcome = {
  asset: number
  platform: Platform
  level: FitLevel
  /** what it lands as: "an Instagram Reel" */
  becomes: string
  /** what goes out: "1080 x 1920 · 9:16 · 30s · 40 MB" */
  spec: string
  /** the plain sentence for a clean channel; empty when there are findings */
  summary: string
  findings: Finding[]
}

export function assetOutcomes(input: {
  probes: AssetProbe[]
  platforms: Platform[]
  kinds?: Partial<Record<Platform, PostKind>>
}): AssetOutcome[] {
  const findings = assessAssets(input)
  const rank: Record<FitLevel, number> = { ok: 0, reframed: 1, degraded: 2, blocked: 3 }
  const rows: AssetOutcome[] = []

  input.probes.forEach((probe, i) => {
    const asset = i + 1
    const spec = delivered(probe)
    for (const platform of input.platforms) {
      const kind = input.kinds?.[platform]
      const mine = findings.filter(f => f.asset === asset && f.platform === platform)
      const level = mine.reduce<FitLevel>(
        (worst, f) => (rank[f.level] > rank[worst] ? f.level : worst), 'ok')
      const becomes = postingAs(platform, kind, probe.type)
      rows.push({
        asset, platform, level, becomes, spec,
        findings: mine,
        summary: mine.length > 0
          ? ''
          : spec
          ? `Goes out as ${becomes}, exactly as you uploaded it — ${spec}.`
          : `Goes out as ${becomes}, exactly as you uploaded it.`,
      })
    }
  })
  return rows
}

function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** One sentence for the whole set — what the person reads first. */
export function fitHeadline(findings: Finding[], platforms: Platform[]): string {
  if (platforms.length === 0) return 'Choose a channel to check these files against.'
  const verdicts = verdictByPlatform(findings, platforms)
  const name = (p: Platform) => PLATFORM_MEDIA[p].label
  const at = (level: FitLevel) => verdicts.filter(v => v.level === level).map(v => name(v.platform))

  const blocked = at('blocked')
  const degraded = at('degraded')
  const reframed = at('reframed')

  if (blocked.length > 0) return `These files will not post on ${list(blocked)}.`
  if (degraded.length > 0) return `Everything posts, but ${list(degraded)} will re-encode your media.`
  if (reframed.length > 0) return `Everything posts, but ${list(reframed)} will crop or trim it.`
  return `These files post untouched on all ${platforms.length} channel${platforms.length === 1 ? '' : 's'}.`
}
