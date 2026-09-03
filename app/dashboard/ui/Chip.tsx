import { cn } from '@/lib/utils'

/**
 * A small pill of status: "Due today", "Approved", "Thu 10:00".
 *
 * Inside an ink `WorkCard` the neutral tones flip to cream on their own: the
 * card marks itself `data-tone="ink"` and the chip answers to it.
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
  ink: 'bg-foreground text-background [[data-tone=ink]_&]:bg-cream [[data-tone=ink]_&]:text-ink',
  surface: 'bg-surface text-foreground border border-border [[data-tone=ink]_&]:border-transparent',
  blue: 'bg-tint-blue text-accent-blue-deep dark:text-cream',
  green: 'bg-tint-green text-foreground',
  amber: 'bg-tint-amber text-foreground',
  red: 'bg-tint-red text-foreground',
  // on an ink card the 6% wash and the ink text both vanish — a chip inside a
  // WorkCard reads its host's `data-tone` and swaps to a cream pair
  muted: 'bg-foreground/[0.06] text-foreground [[data-tone=ink]_&]:bg-cream/[0.14] [[data-tone=ink]_&]:text-cream',
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
