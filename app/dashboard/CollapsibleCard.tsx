'use client'

import { useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'

/**
 * A card that starts folded.
 *
 * The item page had eleven cards and every one of them open, so the thing a
 * person came to do sat under the things they almost never do. A folded card
 * keeps its title and a one-line summary on screen and costs one tap to open
 * — a 44px tap, on the whole header row, keyboard included.
 */
export default function CollapsibleCard({ title, summary, defaultOpen = false, children, id, className }: {
  title: ReactNode
  /** what is inside, in a few words, shown while folded */
  summary?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
  id?: string
  className?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Card id={id} className={`py-0 ${className ?? ''}`}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)}
        className="flex min-h-11 w-full items-center gap-2 px-4 py-2.5 text-left">
        <ChevronRight className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="text-body-15 font-semibold">{title}</span>
        {!open && summary && (
          <span className="ml-auto min-w-0 truncate text-secondary-13 text-muted-foreground">{summary}</span>
        )}
      </button>
      {open && <CardContent className="flex flex-col gap-3 px-4 pb-4 pt-0">{children}</CardContent>}
    </Card>
  )
}
