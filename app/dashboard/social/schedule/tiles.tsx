'use client'

import { Film, ImageIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SocialPostStatus, TileTone } from '@/app/lib/social-schedule-core'
import type { Slide } from '@/app/lib/version-files-core'

/**
 * The small parts every view of the calendar shares: the thumbnail, the
 * status dot and the words for a status.
 *
 * The TONE is `tileTone()` from the core — this file only says what each tone
 * looks like, so the week grid, the month and the list cannot end up drawing
 * the same post three different colours.
 */

/** What a post's status is called on screen. Plain words, not the enum. */
export const STATUS_WORDS: Record<SocialPostStatus, string> = {
  draft: 'Draft',
  pending: 'Waiting for approval',
  approved: 'Approved',
  changes: 'Changes asked for',
  scheduled: 'Scheduled',
  published: 'Posted',
  failed: 'Did not go out',
  cancelled: 'Cancelled',
}

/** The dot in the corner of a tile — the one bit of colour a thumbnail leaves
 *  room for, so the tone has to read at 10px. */
export const DOT_CLASS: Record<TileTone, string> = {
  amber: 'bg-accent-amber',
  red: 'bg-accent-red',
  green: 'bg-accent-green',
  blue: 'bg-accent-blue',
  ink: 'bg-foreground',
  muted: 'bg-foreground/30',
  'red-outline': 'bg-surface ring-2 ring-inset ring-accent-red',
}

/** A cancelled or draft post is still on the calendar, but it must not shout
 *  as loudly as the work that is actually going out. */
export const TONE_DIM: Record<TileTone, string> = {
  amber: '', red: '', green: '', blue: '', ink: '', muted: 'opacity-60', 'red-outline': '',
}

export function StatusDot({ tone, className }: { tone: TileTone; className?: string }) {
  return (
    <span
      className={cn(
        'inline-block h-2.5 w-2.5 shrink-0 rounded-full border-2 border-surface',
        DOT_CLASS[tone], className,
      )}
    />
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
  if (!slide) {
    return (
      <div className={cn('flex items-center justify-center bg-foreground/[0.06] text-muted-foreground', className)}>
        <ImageIcon className="h-4 w-4" strokeWidth={1.8} aria-hidden />
        <span className="sr-only">{label ?? 'No media'}</span>
      </div>
    )
  }
  if (slide.type === 'video') {
    return (
      <div className={cn('flex items-center justify-center bg-ink text-cream', className)}>
        <Film className="h-4 w-4" strokeWidth={1.8} aria-hidden />
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
