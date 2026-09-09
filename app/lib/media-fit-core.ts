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

/** `copied`: OUR encoder makes this channel a copy at its own spec before
 *  it goes — the master is untouched and the channel gets a file inside its
 *  limits, so it does not re-compress it. Not a drop in quality: the
 *  opposite of one. (9 Sep 2026 — the modal said "Quality drops" on
 *  Instagram beside an encoder built to stop exactly that.) */
export type FitLevel = 'ok' | 'copied' | 'reframed' | 'degraded' | 'blocked'

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
      // Meta's own Reels spec, not the 90-second figure Zernio's guide (and most
      // of the internet) still carries: 3 seconds to FIFTEEN MINUTES, 300 MB,
      // any aspect from 0.01:1 to 10:1 with 9:16 recommended, at least 360 px
      // wide. The 90s cap was real once and is the reason "how does Later post
      // longer Reels?" was a fair question — they read the current spec.
      reel: {
        video: {
          maxMB: 300, oversize: 'compress',
          minSeconds: 3, maxSeconds: 15 * 60, overlong: 'reject',
          // outside 9:16 it still POSTS — shown with bars or a crop, which is
          // what `reframed` means — so this stays advisory, never blocking
          aspectMin: VERTICAL_MIN, aspectMax: VERTICAL_MAX, aspectName: '9:16 vertical',
          minWidth: 360,
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
      // LinkedIn's Videos API spec: 500 MB max, 3s-30min, max 1920x1920.
      // https://learn.microsoft.com/en-us/linkedin/marketing/integrations/community-management/shares/videos-api
      maxMB: 500, oversize: 'reject',
      minSeconds: 3, maxSeconds: 30 * 60, overlong: 'reject',
      minWidth: 256, minHeight: 144, maxWidth: 1920, maxHeight: 1920,
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
      // Meta's Facebook Reels spec is 3 to 90 seconds; Zernio's guide says 60,
      // which is the STORY ceiling for a reel shared to a Page's story
      reel: {
        video: {
          minSeconds: 3, maxSeconds: 90, overlong: 'reject',
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
    // Bluesky raised video to 10 minutes and 300 MB on 26 August 2026; the
    // 60s / 50 MB figures in Zernio's guide are the previous limits
    video: {
      formats: ['mp4'],
      maxMB: 300, oversize: 'reject',
      maxSeconds: 10 * 60, overlong: 'reject',
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
  const effective = effectiveKind(platform, type, kind)
  // a carousel is still a feed asset; only Reels and Stories change the rules
  const override = effective && effective !== 'feed' && effective !== 'carousel'
    ? spec.byKind?.[effective]?.[type === 'video' ? 'video' : 'image']
    : undefined
  return override ? { ...base, ...override } : base
}

/**
 * What the platform will actually MAKE of this, whatever the label says.
 *
 * On Instagram there is no such thing as a feed video any more: since 2023
 * every single-video post is published as a Reel, and the provider does the
 * same — one video becomes a Reel. So a file sent as "feed" is judged by Reel
 * rules (9:16, 90 seconds, 300 MB), and the check that took "feed" at its word
 * passed a 2 GB landscape master that Instagram then refused. The label is the
 * operator's; the outcome is the platform's, and the check reads the outcome.
 */
export function effectiveKind(
  platform: Platform, type: MediaType, kind: PostKind | undefined,
): PostKind | undefined {
  if (platform === 'instagram' && type === 'video' && (kind === undefined || kind === 'feed')) return 'reel'
  return kind
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
  /** channels our encoder makes a clean copy for (shrink-core's
   *  `channelsNeedingCopy`) — the size verdict on those is "clean copy",
   *  never "quality drops" */
  copies?: readonly Platform[]
}): Finding[] {
  const findings: Finding[] = []
  const copied = new Set<Platform>(input.copies ?? [])

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
      // a channel getting our clean copy is told so ONCE, here, whatever the
      // master weighs — and the size branch below is skipped for it, because
      // the copy is what goes, and the copy is inside the limit
      if (probe.type === 'video' && copied.has(platform)) {
        push({
          level: 'copied',
          headline: 'Sent as a clean copy',
          detail: `${probe.bytes !== undefined ? `${mb(probe.bytes)}; ` : ''}a copy at ${spec.label}'s own spec (1080p, H.264) is made here first`,
          consequence:
            `Your master is not touched. ${spec.label} receives a file inside its limits, ` +
            'so it does not re-compress it on the way in.',
        })
      } else if (probe.bytes !== undefined && rule.maxMB !== undefined && probe.bytes > rule.maxMB * MB) {
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
          } else if (probe.type === 'video' && rule.aspectName) {
            // a video is never cropped on the vertical channels — it is shown
            // whole, small, with bars above and below. Saying "cropped" sent
            // people looking for a lost edge (9 Sep 2026); the real cost is
            // that a 16:9 clip fills a third of the phone screen
            push({
              level: 'reframed',
              headline: 'Shown with bars',
              detail: `${shape}; ${spec.label}${kindWord(kind)} shows ${rule.aspectName}`,
              consequence:
                'It posts whole, but small, with black bars above and below on a phone. ' +
                'It is your call — a 9:16 cut of the same footage fills the screen.',
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

  const rank: Record<Finding['level'], number> = { blocked: 0, degraded: 1, reframed: 2, copied: 3 }
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
  const rank: Record<FitLevel, number> = { ok: 0, copied: 1, reframed: 2, degraded: 3, blocked: 4 }
  return platforms.map(platform => {
    const mine = findings.filter(f => f.platform === platform)
    const level = mine.reduce<FitLevel>(
      (worst, f) => (rank[f.level] > rank[worst] ? f.level : worst), 'ok')
    return { platform, level, count: mine.length }
  })
}

export const LEVEL_WORDS: Record<FitLevel, { label: string; meaning: string }> = {
  ok:       { label: 'Posts as-is',   meaning: 'Nothing is changed on the way out.' },
  copied:   { label: 'Clean copy',    meaning: 'A copy at this channel\'s own spec is made first. Your master is untouched.' },
  reframed: { label: 'Reshaped',      meaning: 'It posts, in a different shape or length than you gave it.' },
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
        : kind === 'carousel' ? 'a slide in an Instagram carousel'
        // a lone video IS a Reel on Instagram, whatever it was labelled
        : kind === 'reel' || video ? 'an Instagram Reel'
        : 'an Instagram feed post'
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

/**
 * The platform's own short name for a post type — for a menu, where
 * `postingAs` is too long to read.
 *
 * The same upload is a Reel on Instagram, a Short on YouTube and just a video
 * on TikTok. One label for all three is wrong on at least two of them.
 */
export function kindLabel(platform: Platform, kind: PostKind): string {
  if (kind === 'feed') return platform === 'pinterest' ? 'Pin' : 'Feed post'
  if (kind === 'story') return 'Story'
  if (kind === 'carousel') return platform === 'tiktok' ? 'Photo post' : 'Carousel'
  switch (platform) {
    case 'youtube': return 'Short'
    case 'tiktok': return 'Video'
    case 'instagram':
    case 'facebook': return 'Reel'
    default: return 'Short video'
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
  copies?: readonly Platform[]
}): AssetOutcome[] {
  const findings = assessAssets(input)
  const rank: Record<FitLevel, number> = { ok: 0, copied: 1, reframed: 2, degraded: 3, blocked: 4 }
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
  const copied = at('copied')

  if (blocked.length > 0) return `These files will not post on ${list(blocked)}.`
  if (degraded.length > 0) return `Everything posts, but ${list(degraded)} will re-encode your media.`
  if (reframed.length > 0) return `Everything posts, but ${list(reframed)} will show it in a different shape.`
  if (copied.length > 0) return `Everything posts. A clean copy is made for ${list(copied)}; the rest take the file as it is.`
  return `These files post untouched on all ${platforms.length} channel${platforms.length === 1 ? '' : 's'}.`
}

/** The file-size ceiling a channel applies to this kind of file, and what
 *  it does past it. What the automatic smaller copy is decided on. */
export function sizeLimitFor(
  platform: Platform, type: MediaType, kind: PostKind | undefined,
): { maxMB: number; oversize: 'compress' | 'reject' } | null {
  const rule = ruleFor(platform, type, kind)
  if (!rule?.maxMB) return null
  return { maxMB: rule.maxMB, oversize: rule.oversize ?? 'reject' }
}

// ── the encode ladder ─────────────────────────────────────────────────────

/**
 * What a publish-grade copy of a video is encoded AT, per channel.
 *
 * `PLATFORM_MEDIA` above says what a channel will ACCEPT. This says what we
 * should hand it. The two are different questions and the second one has a
 * history: a master over a channel's limit used to be replaced by Cloudflare
 * Stream's web-player MP4, roughly 0.85 Mbps on a long clip. The platform
 * re-compressed that in turn, and the client saw the loss on their own
 * footage. Two re-encodes, the first of them ours, and the first one was the
 * bad one.
 *
 * So the copy is made deliberately: 1080p H.264 High@4.1, CRF 20 with a
 * per-channel bitrate ceiling, AAC 160k, +faststart, BT.709, constant frame
 * rate. `services/encoder` runs it; this decides it.
 *
 * ── The one rule every target must satisfy ──
 *
 *   (maxrate + audio) x seconds / 8 / 1000  <  maxMB
 *
 * A copy that comes back OVER the channel's limit has bought nothing — the
 * channel compresses it, which is the thing this exists to stop. So the
 * bitrate is DERIVED from the channel's own size and length limits and only
 * then capped at the ceiling below; whichever is smaller wins. The property
 * test in tests/media-fit-core.test.ts holds it for every channel and kind.
 */
export type EncodeLadder = {
  /** the most we would ever spend on picture, whatever the budget allows */
  maxrateCapKbps: number
  audioKbps: number
  /** the long side of the finished picture; the short side is the 1080 in "1080p" */
  longSide: number
  shortSide: number
  maxFps: number
}

/**
 * The ceilings, per channel.
 *
 * 8-12 Mbps is where a 1080p H.264 delivery file stops looking obviously
 * compressed on a phone, and it is roughly what each platform's own guidance
 * asks for. Nothing here is a target — a still, easy clip at CRF 16 spends
 * far less — it is the most a hard one may spend.
 *
 * INSTAGRAM IS 20, AND THAT IS DELIBERATE. A 4K event clip at CRF 18 came
 * out at 9,909 kbps against the old 10,000 ceiling on 8 Sep 2026 — the
 * encoder wanted about 12.4 and was stopped, so the picture was being
 * decided by this number instead of by the quality target, which is exactly
 * backwards. Instagram publishes no bitrate limit at all, only 300 MB, and
 * 300 MB over that clip's 108 seconds affords about 18.7 Mbps. At 20 the
 * ceiling effectively never binds and CRF alone decides, which is the whole
 * point of constrained quality. Nothing can overflow: `encodeTargetFor`
 * takes the SMALLER of this and what the channel's size limit affords over
 * the clip's real length, so a long clip is clamped far below it (a
 * ten-minute Reel gets 3.2 Mbps either way).
 *
 * 60 fps where the channel's OWN DOCUMENTATION says it takes it, and 30
 * everywhere else — see docs/PLATFORM_VIDEO_SPECS.md for the page and the
 * date behind every row. Read on 2026-09-08:
 *
 *   Instagram  "Frame rate: 23-60 FPS"                 Instagram Platform → Media
 *   Facebook   "24 to 60 frames per second"            Video API → Reels
 *   Threads    "23-60 FPS"                             Threads → Posts
 *   TikTok     "Minimum of 23 FPS … Maximum of 60 FPS" Media Transfer Guide
 *   YouTube    match the source; 24-60 named           upload encoding settings
 *
 * All five sat at 30 on the belief that "the platform would do that anyway".
 * Nobody had checked, and it was wrong: a 50 fps master lost two frames in
 * five for nothing — measured on a real post (C0584.MP4, 1080p50 in,
 * 1080p30 out, 29 MB against a 300 MB allowance, so not a budget decision
 * either).
 *
 * LinkedIn STAYS at 30 on evidence, not silence: the playback URL their own
 * API hands back is shaped `mp4-720p-30fp-crf28`, so they re-encode to
 * 720p30 whatever we send and the extra frames would be thrown away.
 *
 * X, Pinterest, Bluesky and Reddit stay at 30 because their specifications
 * have NOT been read (their pages 402'd and 404'd on 2026-09-08). Each moves
 * when somebody reads it, never because a different platform moved.
 *
 * On audio: Meta states "Audio Bitrate: 128 kbps" for Threads and "128 kbps
 * or higher" for Facebook Reels. The second is what settles the first — 128
 * is the standard they publish, not a ceiling — so 160 stays.
 */
export const PLATFORM_ENCODE: Record<Platform, EncodeLadder> = {
  instagram: { maxrateCapKbps: 20_000, audioKbps: 160, longSide: 1920, shortSide: 1080, maxFps: 60 },
  facebook:  { maxrateCapKbps: 10_000, audioKbps: 160, longSide: 1920, shortSide: 1080, maxFps: 60 },
  tiktok:    { maxrateCapKbps: 12_000, audioKbps: 160, longSide: 1920, shortSide: 1080, maxFps: 60 },
  linkedin:  { maxrateCapKbps: 10_000, audioKbps: 160, longSide: 1920, shortSide: 1080, maxFps: 30 },
  twitter:   { maxrateCapKbps:  8_000, audioKbps: 160, longSide: 1920, shortSide: 1080, maxFps: 30 },
  youtube:   { maxrateCapKbps: 12_000, audioKbps: 160, longSide: 1920, shortSide: 1080, maxFps: 60 },
  // no published guidance of their own; 8 Mbps is the conservative end of the
  // same band, and none of these four is a channel a 2 GB master goes to
  threads:   { maxrateCapKbps:  8_000, audioKbps: 160, longSide: 1920, shortSide: 1080, maxFps: 60 },
  pinterest: { maxrateCapKbps:  8_000, audioKbps: 160, longSide: 1920, shortSide: 1080, maxFps: 30 },
  bluesky:   { maxrateCapKbps:  8_000, audioKbps: 160, longSide: 1920, shortSide: 1080, maxFps: 30 },
  reddit:    { maxrateCapKbps:  8_000, audioKbps: 160, longSide: 1920, shortSide: 1080, maxFps: 30 },
}

/** How much of a channel's size budget one copy may spend. The margin covers
 *  container overhead and a VBR encoder overshooting its ceiling briefly. */
export const ENCODE_BUDGET_HEADROOM = 0.85

/** A channel with no length limit of its own still needs a number for the
 *  budget maths. Ten minutes is longer than anything this agency posts. */
export const ENCODE_ASSUMED_SECONDS = 10 * 60

/** Below this the copy would be no better than the Stream player file this
 *  service exists to replace, so no copy is offered at all. */
export const ENCODE_MIN_KBPS = 1_500

/** One job for the encoder: everything it needs, and nothing about us. */
export type EncodeTarget = {
  platform: Platform
  maxMB: number
  /** the seconds the budget was worked out for — the clip's own length when
   *  we know it, the channel's ceiling when we do not */
  maxSeconds: number
  maxrateKbps: number
  /**
   * The top of this channel's ladder, sent so the ENCODER can do the sum
   * again once ffprobe has told it how long the clip really is.
   *
   * Most asks are fired the moment the media is attached, which is before
   * anything has measured the file, so `maxrateKbps` above is usually the
   * blind number: the channel's size limit spread over its whole length
   * ceiling. The machine can only correct that upward if it knows what the
   * ceiling was.
   */
  maxrateCapKbps: number
  bufsizeKbps: number
  audioKbps: number
  longSide: number
  shortSide: number
  maxFps: number
}

/**
 * The ladder for one channel, sized to one clip.
 *
 * `seconds` matters: Instagram takes 300 MB and fifteen minutes, and a target
 * that had to be safe for a fifteen-minute Reel would be 2 Mbps — right for
 * that clip and needlessly poor for the 20-second one actually being posted.
 * So the budget is worked out for the clip in hand, and only falls back to
 * the channel's ceiling when nobody measured the file.
 *
 * Returns null when no copy is worth making: the channel has no video limit
 * to fit inside, or the budget will not stretch to a bitrate better than the
 * player file we already have.
 */
export function encodeTargetFor(
  platform: Platform, kind: PostKind | undefined, seconds?: number,
): EncodeTarget | null {
  const ladder = PLATFORM_ENCODE[platform]
  const rule = ruleFor(platform, 'video', kind)
  if (!ladder || !rule?.maxMB) return null

  const ceiling = rule.maxSeconds ?? ENCODE_ASSUMED_SECONDS
  const measured = seconds !== undefined && Number.isFinite(seconds) && seconds > 0
    ? Math.ceil(seconds)
    : null
  // never budget for LESS than the clip, and never for more than the channel
  const maxSeconds = Math.max(1, Math.min(measured ?? ceiling, ceiling))

  // what the channel's own size limit affords, once the sound is paid for
  const affordable = Math.floor(
    (ENCODE_BUDGET_HEADROOM * rule.maxMB * 8 * 1000) / maxSeconds,
  ) - ladder.audioKbps
  const maxrateKbps = Math.min(ladder.maxrateCapKbps, affordable)
  if (maxrateKbps < ENCODE_MIN_KBPS) return null

  return {
    platform,
    maxMB: rule.maxMB,
    maxSeconds,
    maxrateKbps,
    maxrateCapKbps: ladder.maxrateCapKbps,
    // twice the maxrate: the buffer a VBR encoder is allowed to swing inside
    bufsizeKbps: maxrateKbps * 2,
    audioKbps: ladder.audioKbps,
    longSide: ladder.longSide,
    shortSide: ladder.shortSide,
    maxFps: ladder.maxFps,
  }
}

/**
 * What this channel takes of one video, in MB and in seconds.
 *
 * The same rule `encodeTargetFor` budgets against, exported on its own so the
 * publish path can ask "is this file small enough to send?" without having to
 * rebuild a whole encode target — and can still ask it for a channel no copy
 * could ever be made for.
 */
export function videoLimitsFor(
  platform: Platform, kind?: PostKind,
): { maxMB: number | null; maxSeconds: number | null } | null {
  const rule = ruleFor(platform, 'video', kind)
  if (!rule) return null
  return { maxMB: rule.maxMB ?? null, maxSeconds: rule.maxSeconds ?? null }
}

/**
 * Why this finished copy cannot be sent to this channel, if it cannot.
 *
 * The copy is checked AGAIN, against the same limit it was made to fit. Every
 * number in the ladder is a promise about a file nobody has weighed yet — a
 * trim that did not happen, a bitrate ceiling an encoder overshot, a row
 * written before the machine started sizing its own copies — and a copy that
 * quietly came out at three times the channel's limit is the client's post
 * failing at the provider, or being re-compressed to mush, with nothing
 * anywhere saying why.
 *
 * Returns null when the copy is fine, or when nothing is known about its size.
 */
export function copyTooBigReason(
  platform: Platform, kind: PostKind | undefined, bytes: number | null | undefined,
): string | null {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return null
  const limits = videoLimitsFor(platform, kind)
  if (!limits?.maxMB) return null
  if (bytes <= limits.maxMB * MB) return null
  const label = `${PLATFORM_MEDIA[platform]?.label ?? platform}${kindWord(kind)}`
  return `The copy came out at ${mb(bytes)} and ${label} only takes ${limitMB(limits.maxMB)} — post a shorter or smaller export`
}

/** The biggest this target's copy could come out at, in MB. The number the
 *  property "a copy always fits the channel" is checked on. */
export function encodeWorstCaseMB(target: EncodeTarget): number {
  return ((target.maxrateKbps + target.audioKbps) * target.maxSeconds) / 8 / 1000
}
