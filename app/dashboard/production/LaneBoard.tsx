'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useIsMobile } from '../useIsMobile'

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

  const column = (lane: Lane, grow: boolean) => (
    <div key={lane.key} className={grow ? 'min-w-44 flex-1' : 'w-full'}>
      {!mobile && (
        <div className="mb-2 flex items-center gap-2 px-1">
          <span className={`h-2 w-2 rounded-full ${lane.tint}`} />
          <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{lane.title}</span>
          {lane.hint}
          <span className="ml-auto font-mono text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500">{lane.count}</span>
        </div>
      )}
      <div className="flex min-h-24 flex-col gap-2">
        {lane.replace ?? lane.cards}
        {lane.count === 0 && !lane.replace && (
          <div className="rounded-lg border border-dashed border-zinc-200 py-6 text-center text-xs text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
            {lane.empty}
          </div>
        )}
      </div>
    </div>
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
                className={`flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors ${
                  active
                    ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                    : 'border-zinc-200 text-zinc-600 dark:border-zinc-800 dark:text-zinc-300'
                }`}>
                <span className={`h-2 w-2 rounded-full ${active ? 'bg-white/80 dark:bg-zinc-900/70' : l.tint}`} />
                {l.title}
                <span className={`font-mono text-[11px] tabular-nums ${active ? 'opacity-80' : 'text-zinc-400 dark:text-zinc-500'}`}>{l.count}</span>
              </button>
            )
          })}
        </div>
        {lane && (
          <div role="tabpanel" className="flex items-center gap-2 px-1">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {lane.count === 1 ? '1 item' : `${lane.count} items`} in <span className="font-medium text-zinc-700 dark:text-zinc-200">{lane.title}</span>
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
      <div className="flex gap-3 pb-3">
        {lanes.map(l => column(l, true))}
      </div>
    </div>
  )
}
