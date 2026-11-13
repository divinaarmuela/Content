import { Skeleton } from '@/components/ui/skeleton'
import { POST_APPROVAL_LANES } from '../../../lib/post-stage-core'

/**
 * POST APPROVAL WHILE IT LOADS (the owner, 13 Nov 2026: "it needs skeleton, load nicely, because some have cards
 * layout shifts"). The page used to wait behind two grey blocks and then jump to a toolbar and six columns. This is
 * the same shape as what arrives: the toolbar's line, then every column under its real name with grey cards the size
 * of real ones, so nothing moves when the posts land.
 */

/** one grey card, the size of a post's card: its picture, its name, two chips, a line, a button */
export function CardSkeleton() {
  return (
    <div className="flex flex-col gap-2.5 rounded-inner border border-border bg-surface p-3" aria-hidden>
      <Skeleton className="h-[92px] w-full rounded-tile" />
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-4 w-3/4" />
      <div className="flex gap-2"><Skeleton className="h-7 w-24 rounded-full" /><Skeleton className="h-7 w-20 rounded-full" /></div>
      <Skeleton className="h-3 w-5/6" />
      <Skeleton className="h-9 w-36 rounded-full" />
    </div>
  )
}

const COLUMNS = [...POST_APPROVAL_LANES.map(l => l.label), 'Going out today']

export default function BoardSkeleton() {
  return (
    <div role="status" aria-label="Loading the board" aria-busy="true" className="flex flex-col gap-3" data-board-skeleton>
      {/* the toolbar's line: client, search, and Columns · List on the right */}
      <div className="flex flex-wrap items-center gap-2" aria-hidden>
        <Skeleton className="h-11 w-[210px] rounded-full" />
        <Skeleton className="h-11 w-full rounded-full sm:w-[260px]" />
        <Skeleton className="ml-auto h-11 w-[250px] rounded-full" />
      </div>
      <div className="w-full overflow-x-hidden">
        <div className="flex gap-3.5 pb-3">
          {COLUMNS.map((label, i) => (
            <div key={label} className="min-w-[248px] flex-1">
              <div className="mb-2.5 flex items-center justify-between px-1">
                <span className="text-[14px] font-semibold text-foreground">{label}</span>
                <Skeleton className="h-5 w-8 rounded-full" />
              </div>
              <div className="flex flex-col gap-2.5">
                {Array.from({ length: i % 3 === 1 ? 2 : 3 }).map((_, n) => <CardSkeleton key={n} />)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
