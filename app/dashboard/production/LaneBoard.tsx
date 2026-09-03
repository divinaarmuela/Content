'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useIsMobile } from '../useIsMobile'
import UiLane from '../ui/Lane'

export type Lane = {
  key: string
  title: string
  /** the dot colour class, e.g. bg-blue-500 */
  tint: string
  count: number
  /** what is NOT here, in the column's own words */
  empty: string
  cards: ReactNode[]
  /** a `?` or other decoration after the title */
  hint?: ReactNode
  /** for a tail column: something to show instead of the cards */
  replace?: ReactNode
}

/**
 * The columns of a board — five side by side on a desk, ONE at a time on a
 * phone, with a picker to swap between them.
 *
 * Five `min-w-44` lanes inside `overflow-x-auto` was ~900px of sideways
 * scroll on a 390px screen with no cue that lanes three to five existed. A
 * phone user's whole model of the board was the first column. Now the lane
 * names are the navigation: each pill carries its count, the one with the
 * viewer's work opens first, and every pill is a 44px target.
 *
 * Presentation only — every rule about which card is in which lane belongs
 * to the page and to work-pages-core.
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
    </>
  )

  const column = (lane: Lane, grow: boolean) =>
    mobile ? (
      <div key={lane.key} className="flex w-full flex-col gap-2.5">{stack(lane)}</div>
    ) : (
      <UiLane key={lane.key} title={lane.title} count={lane.count} hint={lane.hint}
        className={grow ? 'min-w-[220px]' : ''}>
        {stack(lane)}
      </UiLane>
    )

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
        {lane && column(lane, false)}
      </div>
    )
  }

  return (
    <div className="w-full overflow-x-auto">
      <div className="flex gap-3.5 pb-3">
        {lanes.map(l => column(l, true))}
      </div>
    </div>
  )
}
