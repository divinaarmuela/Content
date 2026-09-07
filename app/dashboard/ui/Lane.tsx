import { cn } from '@/lib/utils'

/**
 * One column of the board: a name, how many things are in it, and the cards.
 *
 * The count is part of the heading rather than a badge somewhere else — the
 * first question anyone asks a board is "how much is sitting here".
 *
 * A FOLDED lane (several stages the viewer does not work, kept in one narrow
 * strip) draws the same heading muted, so the eye goes to the lanes that are
 * theirs; `control` is the one button such a lane carries in its heading —
 * the chevron that collapses it to a rail.
 */
export default function Lane({
  title, count, children, className, hint, muted, control,
}: {
  title: string
  count: number
  children?: React.ReactNode
  className?: string
  /** a plain-words explainer beside the name — the "?" a lane sometimes needs */
  hint?: React.ReactNode
  /** a quieter heading, for a lane that is not the viewer's own work */
  muted?: boolean
  /** a button at the end of the heading (a folded lane's collapse chevron) */
  control?: React.ReactNode
}) {
  return (
    <section className={cn('flex min-w-0 flex-1 flex-col gap-2.5', className)}>
      <div className="flex items-center gap-1.5 px-1 pb-1">
        {/* the hint is a sibling, not part of the heading — a "?" button
            inside the <h2> would become part of the column's name */}
        <h2 className={cn('min-w-0 truncate text-[15px] font-semibold', muted && 'text-muted-foreground')}>{title}</h2>
        {hint}
        <span className={cn(
          'ml-auto shrink-0 rounded-full px-2.5 py-[3px] text-[12px] font-bold tabular-nums',
          muted ? 'bg-foreground/[0.05] text-muted-foreground' : 'bg-foreground/[0.08] text-foreground',
        )}>
          {count}
        </span>
        {control}
      </div>
      <div className="flex flex-col gap-2.5">{children}</div>
    </section>
  )
}
