'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useIsMobile } from '../useIsMobile'
import UiLane from '../ui/Lane'

export type Lane = {
  key: string
  title: string
  count: number
  /** what is NOT here, in the column's own words */
  empty: string
  cards: ReactNode[]
  /** a `?` or other decoration after the title */
  hint?: ReactNode
  /** for a tail column: something to show instead of the cards */
  replace?: ReactNode
  /** a quiet line under the cards — where the things not shown here went */
  footer?: ReactNode
  /**
   * a FOLDED lane: several stages the viewer does not work, kept in one
   * narrow strip (~200px) with a muted heading. It collapses to a 44px rail
   * carrying the count; the board owns the choice (`collapsed`, `onToggle`).
   */
  folded?: boolean
  collapsed?: boolean
  onToggle?: () => void
}

/**
 * The columns of a board — side by side on a desk, ONE at a time on a
 * phone, with a picker to swap between them.
 *
 * Five `min-w-44` lanes inside `overflow-x-auto` was ~900px of sideways
 * scroll on a 390px screen with no cue that lanes three to five existed. A
 * phone user's whole model of the board was the first column. Now the lane
 * names are the navigation: each pill carries its count, the one with the
 * viewer's work opens first, and every pill is a 44px target.
 *
 * A folded lane takes little room on a desk and can be shut to a rail; on a
 * phone it is simply one more pill, because there is nothing to fold.
 *
 * Presentation only — every rule about which card is in which lane belongs
 * to the page and to board-view-core.
 */
export function LaneBoard({ lanes, initialLane, ariaLabel }: {
  lanes: Lane[]
  /** the lane to open on a phone; defaults to the first one with cards */
  initialLane?: string
  ariaLabel: string
}) {
  const mobile = useIsMobile()
  const [picked, setPicked] = useState<string | null>(null)
  const fallback = initialLane ?? lanes.find(l => l.count > 0)?.key ?? lanes[0]?.key ?? null
  const current = picked ?? fallback

  // a lane that stopped existing (a filter change) must not leave a blank
  // board behind
  useEffect(() => {
    if (picked && !lanes.some(l => l.key === picked)) setPicked(null)
  }, [lanes, picked])

  /** the cards of one lane, with the column's own words when it is empty */
  const stack = (lane: Lane) => (
    <>
      {lane.replace ?? lane.cards}
      {lane.count === 0 && !lane.replace && (
        <div className="rounded-inner border border-dashed border-border px-3 py-7 text-center text-[13px] text-muted-foreground">
          {lane.empty}
        </div>
      )}
      {lane.footer}
    </>
  )

  /** a folded lane shut to a rail: the chevron opens it, the count stays */
  const rail = (lane: Lane, index: number) => {
    const Icon = index === 0 ? ChevronRight : ChevronLeft
    return (
      <button
        key={lane.key}
        type="button"
        aria-expanded={false}
        aria-label={`Show ${lane.title} — ${lane.count} ${lane.count === 1 ? 'card' : 'cards'}`}
        title={`Show ${lane.title}`}
        onClick={lane.onToggle}
        className="flex w-11 min-w-11 shrink-0 flex-col items-center gap-2 self-stretch rounded-inner border border-dashed border-border bg-surface py-2 text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
      >
        <Icon className="h-4 w-4" strokeWidth={1.8} />
        <span className="rounded-full bg-foreground/[0.06] px-2 py-[2px] text-[12px] font-bold tabular-nums">{lane.count}</span>
        <span className="mt-1 text-[12px] font-semibold uppercase tracking-[0.04em] [writing-mode:vertical-rl]">{lane.title}</span>
      </button>
    )
  }

  const column = (lane: Lane, index: number) => {
    if (mobile) return <div key={lane.key} className="flex w-full flex-col gap-2.5">{stack(lane)}</div>
    if (lane.folded && lane.collapsed) return rail(lane, index)
    const Icon = index === 0 ? ChevronLeft : ChevronRight
    const control = lane.folded && lane.onToggle ? (
      <button
        type="button"
        aria-expanded
        aria-label={`Hide ${lane.title}`}
        title={`Hide ${lane.title}`}
        onClick={lane.onToggle}
        className="-mr-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
      >
        <Icon className="h-4 w-4" strokeWidth={1.8} />
      </button>
    ) : undefined
    return (
      <UiLane key={lane.key} title={lane.title} count={lane.count} hint={lane.hint}
        muted={lane.folded} control={control}
        className={lane.folded ? 'w-[200px] min-w-[200px] flex-none' : 'min-w-[220px]'}>
        {stack(lane)}
      </UiLane>
    )
  }

  if (mobile) {
    const lane = lanes.find(l => l.key === current) ?? lanes[0]
    return (
      <div className="flex flex-col gap-3">
        <div role="tablist" aria-label={ariaLabel}
          className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {lanes.map(l => {
            const active = l.key === lane?.key
            return (
              <button key={l.key} type="button" role="tab" aria-selected={active}
                onClick={() => setPicked(l.key)}
                className={`flex min-h-11 shrink-0 items-center gap-2 rounded-full px-4 text-[14px] font-semibold transition-colors ${
                  active
                    ? 'bg-foreground text-background'
                    : 'border border-border bg-surface text-muted-foreground'
                }`}>
                {l.title}
                <span className={`text-[12px] font-bold tabular-nums ${active ? 'opacity-80' : 'text-foreground/60'}`}>{l.count}</span>
              </button>
            )
          })}
        </div>
        {lane && (
          <div role="tabpanel" className="flex items-center gap-2 px-1">
            <span className="text-[13px] text-muted-foreground">
              {lane.count === 1 ? '1 item' : `${lane.count} items`} in <span className="font-semibold text-foreground">{lane.title}</span>
            </span>
            {lane.hint}
          </div>
        )}
        {lane && column(lane, 0)}
      </div>
    )
  }

  return (
    <div className="w-full overflow-x-auto">
      <div className="flex gap-3.5 pb-3">
        {lanes.map((l, i) => column(l, i))}
      </div>
    </div>
  )
}
