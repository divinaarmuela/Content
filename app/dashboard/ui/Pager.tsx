'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { clampPage, pageCount, pageWords } from '../../lib/pager-core'

/**
 * LEFT AND RIGHT under a list that is shown a few rows at a time (pager-core). Draws nothing when everything fits
 * on one page. The buttons are the calendar's: 44px to press, a quiet circle on hover.
 */
export default function Pager({ page, total, size, onPage, what, className }: {
  page: number
  total: number
  size: number
  onPage: (page: number) => void
  /** what is being paged, for the buttons' names: "posts", "comments" */
  what: string
  className?: string
}) {
  const pages = pageCount(total, size)
  if (pages <= 1) return null
  const p = clampPage(page, total, size)
  const btn = 'flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-foreground transition-colors hover:bg-foreground/[0.06] disabled:opacity-30 disabled:hover:bg-transparent'
  return (
    <div className={cn('-mx-2 -mb-2 flex items-center justify-between gap-2', className)} data-pager>
      <button type="button" aria-label={`Earlier ${what}`} disabled={p === 0} onClick={() => onPage(p - 1)} className={btn}>
        <ChevronLeft className="h-[18px] w-[18px]" strokeWidth={1.8} />
      </button>
      <span className="text-[12px] font-semibold tabular-nums text-muted-foreground" aria-live="polite">{pageWords(p, total, size)}</span>
      <button type="button" aria-label={`Later ${what}`} disabled={p >= pages - 1} onClick={() => onPage(p + 1)} className={btn}>
        <ChevronRight className="h-[18px] w-[18px]" strokeWidth={1.8} />
      </button>
    </div>
  )
}
