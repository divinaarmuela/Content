import Link from 'next/link'
import { cn } from '@/lib/utils'

/**
 * Today, in order: the time down the left, what is happening beside it.
 *
 * Each row is tinted by what kind of thing it is — a shoot is amber, a post
 * going live is blue, a client review is green — so the shape of the day
 * reads before any of the words do.
 */

export type TimelineTone = 'amber' | 'blue' | 'green' | 'red' | 'paper' | 'surface'

const TONE: Record<TimelineTone, string> = {
  amber: 'bg-tint-amber',
  blue: 'bg-tint-blue',
  green: 'bg-tint-green',
  red: 'bg-tint-red',
  paper: 'bg-paper',
  surface: 'border border-border bg-surface',
}

export type TimelineItem = {
  /** already formatted for a person: "09:00", not an ISO stamp */
  time: string
  title: string
  detail?: string
  tone?: TimelineTone
  /** makes the row a link to the thing it is about */
  href?: string
}

export default function Timeline({
  items, empty = 'Nothing on today.', className,
}: {
  items: TimelineItem[]
  /** plain words for a day with nothing in it */
  empty?: string
  className?: string
}) {
  if (items.length === 0) {
    return <p className={cn('text-[13px] text-muted-foreground', className)}>{empty}</p>
  }

  return (
    <ol className={cn('flex flex-col gap-2.5', className)}>
      {items.map((it, i) => {
        const body = (
          <>
            <span className="text-[14px] font-semibold">{it.title}</span>
            {it.detail && <span className="text-[12px] text-muted-foreground">{it.detail}</span>}
          </>
        )
        const bodyClass = cn(
          'flex min-w-0 flex-1 flex-col gap-0.5 rounded-[14px] px-3 py-2.5 text-foreground',
          TONE[it.tone ?? 'paper'],
        )
        return (
          <li key={`${it.time}-${it.title}-${i}`} className="flex items-start gap-3">
            <span className="w-11 shrink-0 pt-1 text-[12px] font-semibold tabular-nums text-muted-foreground">
              {it.time}
            </span>
            {it.href
              ? <Link href={it.href} className={cn(bodyClass, 'transition-opacity hover:opacity-90')}>{body}</Link>
              : <div className={bodyClass}>{body}</div>}
          </li>
        )
      })}
    </ol>
  )
}
