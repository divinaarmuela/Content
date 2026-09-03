import { cn } from '@/lib/utils'

/**
 * One column of the board: a name, how many things are in it, and the cards.
 *
 * The count is part of the heading rather than a badge somewhere else — the
 * first question anyone asks a board is "how much is sitting here".
 */
export default function Lane({
  title, count, children, className, hint,
}: {
  title: string
  count: number
  children?: React.ReactNode
  className?: string
  /** a plain-words explainer beside the name — the "?" a lane sometimes needs */
  hint?: React.ReactNode
}) {
  return (
    <section className={cn('flex min-w-0 flex-1 flex-col gap-2.5', className)}>
      <div className="flex items-center justify-between gap-2 px-1 pb-1">
        <h2 className="flex min-w-0 items-center gap-1.5 text-[15px] font-semibold">
          <span className="min-w-0 truncate">{title}</span>
          {hint}
        </h2>
        <span className="shrink-0 rounded-full bg-foreground/[0.08] px-2.5 py-[3px] text-[12px] font-bold tabular-nums text-foreground">
          {count}
        </span>
      </div>
      <div className="flex flex-col gap-2.5">{children}</div>
    </section>
  )
}
