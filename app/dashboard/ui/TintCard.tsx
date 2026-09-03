import Link from 'next/link'
import { cn } from '@/lib/utils'

/**
 * A colour-tinted panel: the big rounded blocks across the top of the mockup's
 * Overview. The tone carries the meaning — amber is "needs you", blue is
 * "going out", green is "ready to look at", paper and surface are neutral —
 * so the same card can be read at a glance before any of the words are.
 *
 * Presentation only: no data, no state. The tints are the `tint-*` tokens, so
 * they become the 18% dark overlays automatically in dark mode.
 */

export type TintTone = 'amber' | 'blue' | 'green' | 'paper' | 'surface'

const TONE: Record<TintTone, string> = {
  amber: 'bg-tint-amber',
  blue: 'bg-tint-blue',
  green: 'bg-tint-green',
  paper: 'bg-paper',
  // the only tone that needs an edge: white on cream (and #141414 on ink)
  // has nothing else to separate it from the canvas
  surface: 'bg-surface border border-border',
}

export default function TintCard({
  tone = 'surface', title, action, children, className,
}: {
  tone?: TintTone
  title: string
  /** the one link out of this card, e.g. { label: 'Scheduler', href: '/dashboard/scheduler' } */
  action?: { label: string; href: string }
  children?: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn('flex flex-col gap-[18px] rounded-card px-6 py-[22px] text-foreground', TONE[tone], className)}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="min-w-0 text-card-title">{title}</h2>
        {action && (
          <Link
            href={action.href}
            /* -my-3 keeps the 44px tap target from stretching the header row */
            className="-my-3 inline-flex min-h-11 shrink-0 items-center text-[13px] font-semibold text-foreground underline-offset-4 hover:underline"
          >
            {action.label}
          </Link>
        )}
      </div>
      {children}
    </section>
  )
}
