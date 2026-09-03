import { cn } from '@/lib/utils'

/**
 * A small pill of status: "Due today", "Approved", "Thu 10:00".
 *
 * A chip states a fact — it is never a button and never the only place an
 * action lives. Tones carry the same meaning as the card tints: amber needs
 * you, blue is scheduled, green is done, red has failed, ink is the current
 * thing, surface sits on top of a tint, muted is a plain count.
 */

export type ChipTone = 'ink' | 'surface' | 'blue' | 'green' | 'amber' | 'red' | 'muted'

const TONE: Record<ChipTone, string> = {
  // `foreground`/`background` rather than literal ink/cream: the pill has to
  // invert in dark mode or it disappears into the canvas
  ink: 'bg-foreground text-background',
  surface: 'bg-surface text-foreground border border-border',
  blue: 'bg-tint-blue text-accent-blue-deep dark:text-cream',
  green: 'bg-tint-green text-foreground',
  amber: 'bg-tint-amber text-foreground',
  red: 'bg-tint-red text-foreground',
  muted: 'bg-foreground/[0.06] text-foreground',
}

export default function Chip({
  tone = 'muted', children, className,
}: {
  tone?: ChipTone
  children: React.ReactNode
  className?: string
}) {
  return (
    <span className={cn('inline-flex max-w-full items-center gap-1.5 truncate rounded-full px-2.5 py-1.5 text-chip-12', TONE[tone], className)}>
      {children}
    </span>
  )
}
