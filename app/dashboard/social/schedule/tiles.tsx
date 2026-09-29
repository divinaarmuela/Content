'use client'

import { useState } from 'react'
import { Film, ImageIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePlayable } from '../usePlayable'
import PlatformIcon from '../PlatformIcon'
import type { StageTone } from '@/app/lib/post-stage-core'
import type { Slide } from '@/app/lib/version-files-core'

/**
 * The small parts every view of the calendar shares: the thumbnail, the
 * stage dot, the "!" that says something is wrong, and the network logos.
 *
 * The WORDS and the TONE of a post come from `post-stage-core`'s one list
 * (STAGE_WORDS), through `scheduleFacts` — this file only says what each tone
 * looks like, so the week grid, the month and the list cannot end up drawing
 * the same post three different colours or calling it two different things.
 */

/** What each stage tone looks like as a 10px dot. */
export const STAGE_DOT: Record<StageTone, string> = {
  ink: 'bg-foreground',
  surface: 'bg-surface ring-1 ring-inset ring-foreground/40',
  blue: 'bg-accent-blue',
  green: 'bg-accent-green',
  amber: 'bg-accent-amber',
  red: 'bg-accent-red',
  muted: 'bg-foreground/30',
}

/** A cancelled post is still listed, but it must not shout as loudly as the
 *  work that is actually going out. */
export const STAGE_DIM: Record<StageTone, string> = {
  ink: '', surface: '', blue: '', green: '', amber: '', red: '', muted: 'opacity-60',
}

/** The ring a tile wears when something is wrong with it — a tile that will
 *  not go out never looks like one that will (audit S13). */
export const STAGE_RING: Record<StageTone, string> = {
  ink: '', surface: '', blue: '', green: '', amber: 'ring-2 ring-inset ring-accent-amber', red: 'ring-2 ring-inset ring-accent-red', muted: '',
}

export function StageDot({ tone, className }: { tone: StageTone; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block h-2.5 w-2.5 shrink-0 rounded-full border-2 border-surface', STAGE_DOT[tone], className)}
    />
  )
}

/**
 * THE "!" ON A TILE: something stops this post going out, or its time has
 * passed. Visible on a phone and in the list, not only in a hover title
 * (audit S13). The sentence is beside it in the List and in its label here.
 */
export function AlertMark({ label, className }: { label: string; className?: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn('flex h-4 w-4 items-center justify-center rounded-full bg-accent-red text-[11px] font-bold leading-none text-cream', className)}
    >
      !
    </span>
  )
}

/**
 * EVERY NETWORK A POST GOES TO, not only the first (audit S14): a post for
 * Instagram and TikTok must not read as Instagram-only. `max` logos, then "+n".
 */
export function NetworkLogos({ platforms, size = 14, max = 3, className }: {
  platforms: readonly string[]
  size?: number
  max?: number
  className?: string
}) {
  if (platforms.length === 0) return null
  const shown = platforms.slice(0, max)
  const more = platforms.length - shown.length
  return (
    <span className={cn('flex items-center -space-x-1', className)}>
      {shown.map(p => (
        <span key={p} className="flex items-center justify-center rounded-full bg-ink ring-1 ring-surface" style={{ height: size + 4, width: size + 4 }}>
          <PlatformIcon platform={p} size={size} className="rounded-full" />
        </span>
      ))}
      {more > 0 && (
        <span className="flex items-center justify-center rounded-full bg-ink px-1 text-[10px] font-bold text-cream ring-1 ring-surface" style={{ height: size + 4 }}>
          +{more}
        </span>
      )}
    </span>
  )
}

/**
 * One piece of media.
 *
 * A video has no still to show without decoding it, so it gets a dark plate
 * and a film mark rather than a broken picture — honest, and it reads at
 * tile size.
 */
export function Thumb({ slide, className, label }: {
  slide: Slide | null | undefined
  className?: string
  label?: string
}) {
  // the encoder's .mp4 copy when there is one — a camera .mov the browser
  // cannot decode drew a black tile (10 Sep 2026)
  const playable = usePlayable()
  const [broken, setBroken] = useState<string | null>(null)
  if (!slide) {
    return (
      <div className={cn('flex items-center justify-center bg-foreground/[0.06] text-muted-foreground', className)}>
        <ImageIcon className="h-4 w-4" strokeWidth={1.8} aria-hidden />
        <span className="sr-only">{label ?? 'No media'}</span>
      </div>
    )
  }
  if (slide.type === 'video') {
    // A frame from the clip, not a film icon. `#t=0.5` asks the browser to
    // seek half a second in, so a fade-from-black master does not show as a
    // black square; `preload="metadata"` reads only the header and that one
    // frame. The icon stays underneath for the moment before it paints and
    // for a file the browser cannot decode.
    return (
      <div className={cn('relative flex items-center justify-center overflow-hidden bg-ink text-cream', className)}>
        <Film className="h-4 w-4" strokeWidth={1.8} aria-hidden />
        {broken !== slide.url && (
          <video
            src={`${playable(slide.url)}#t=0.5`}
            muted
            playsInline
            preload="metadata"
            aria-hidden
            tabIndex={-1}
            onError={() => setBroken(slide.url)}
            className="pointer-events-none absolute inset-0 h-full w-full object-cover"
          />
        )}
        <span className="sr-only">{label ?? slide.name}</span>
      </div>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={slide.url}
      alt={label ?? slide.name}
      loading="lazy"
      className={cn('object-cover', className)}
    />
  )
}

/**
 * The time on a tile: "12:00", "18:30" — the clock, with no am/pm.
 *
 * Ten pixels inside an 80px tile is not enough room for a meridiem, and the
 * calendar already says which half of the day a row is in: the tile sits on
 * the 6 PM line. Read in the CLIENT's zone like every other time on the page.
 */
export function clockLabel(iso: string | null | undefined, tz: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  try {
    return d.toLocaleTimeString('en-AU', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
    })
  } catch {
    return ''
  }
}
