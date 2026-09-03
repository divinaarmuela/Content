'use client'

import type { BatchStatus } from '../../lib/batch-brief-core'
import type { Batch } from './NewItemDialog'

/**
 * `/api/team/me` answered, and it did not know who we are.
 *
 * The work pages hang everything off the viewer, so without one there is
 * nothing honest to draw. Showing the loading skeleton forever would be a lie
 * about what is happening; this says it, and names the two things that fix it.
 */
export function AccountUnavailable() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-border bg-surface px-6 py-14 text-center">
      <p className="text-body-15 text-muted-foreground">
        Couldn’t load your account — refresh, or sign in again.
      </p>
    </div>
  )
}

/** Status badge classes shared by the shoots view, brief page, and board chips. */
export const BATCH_STATUS_STYLE: Record<BatchStatus, string> = {
  brief: 'border-accent-amber/35 bg-tint-amber text-foreground',
  locked: 'border-border bg-paper text-foreground',
  shot: 'border-accent-green/30 bg-tint-green text-foreground',
  wrapped: 'border-border bg-foreground/[0.04] text-muted-foreground',
}

/** The words for those four stages live with the states themselves, in
 *  batch-brief-core — re-exported here because this is where the surfaces
 *  already reach for a shoot's presentation. */
export { BATCH_STATUS_LABEL } from '../../lib/batch-brief-core'

/** Priority flag colour. One copy, worn by every work card. */
export const PRIORITY_TINT: Record<string, string> = {
  urgent: 'text-accent-red',
  high: 'text-accent-amber',
  normal: 'text-muted-foreground',
  low: 'text-muted-foreground/50',
}

/** The little pill naming a work kind. */
export const KIND_CHIP: Record<string, string> = {
  zinc: 'bg-foreground/[0.06] text-muted-foreground',
  pink: 'bg-tint-red text-foreground',
  sky: 'bg-tint-blue text-accent-blue-deep',
  indigo: 'bg-tint-blue text-accent-blue-deep',
  violet: 'bg-tint-blue text-accent-blue-deep',
  emerald: 'bg-tint-green text-foreground',
  amber: 'bg-tint-amber text-foreground',
  rose: 'bg-tint-red text-accent-red',
}

/** Card face per work kind — a coloured edge and a faint wash, so a column
 *  full of mixed work reads at a glance instead of as plain white cards. */
export const KIND_CARD: Record<string, string> = {
  zinc: '',
  pink: 'border-l-2 border-l-accent-red/30 bg-tint-red',
  sky: 'border-l-2 border-l-accent-blue/25 bg-tint-blue',
  indigo: 'border-l-2 border-l-accent-blue/25 bg-tint-blue',
  violet: 'border-l-2 border-l-accent-blue/25 bg-tint-blue',
  emerald: 'border-l-2 border-l-accent-green/30 bg-tint-green',
  amber: 'border-l-2 border-l-accent-amber/35 bg-tint-amber',
  rose: 'border-l-2 border-l-accent-red/30 bg-tint-red',
}

/** The same pressed pill the lane tabs wear: 44px, ink when it is the one on. */
const chip = (active: boolean) =>
  `inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-4 text-[14px] font-semibold transition-colors ${
    active ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
  }`

/**
 * The shoot chips above a board.
 *
 * Shoots exist as first-class things, not just a dropdown inside the create
 * dialog — a new one appears here immediately, and clicking it narrows the
 * board to that shoot's items. Clicking the chip that is already on clears it.
 */
export function ShootChips({ batches, clientFilter, value, onChange, countFor }: {
  batches: Batch[]
  clientFilter: string
  value: string
  onChange: (batchId: string) => void
  /** how many rows the BOARD will draw for this shoot. The batch row carries a
   *  content_items count that includes brief tasks and finished work, so a
   *  chip reading 2 sat above a board showing one card. */
  countFor?: (batchId: string) => number
}) {
  if (batches.length === 0) return null
  return (
    <div className="flex max-w-full flex-wrap items-center gap-1.5 rounded-full border border-border bg-surface p-1">
      <span className="ml-3 mr-1 text-[13px] font-semibold text-muted-foreground">Shoots</span>
      <button type="button" aria-pressed={value === 'all'}
        onClick={() => onChange('all')} className={chip(value === 'all')}>
        All
      </button>
      {batches
        .filter(b => (b.status ?? 'shot') !== 'brief')
        .filter(b => clientFilter === 'all' || b.client_id === clientFilter)
        .map(b => {
          const count = countFor ? countFor(b.id) : b.content_items?.[0]?.count ?? 0
          return (
            <button key={b.id} type="button" aria-pressed={value === b.id}
              onClick={() => onChange(value === b.id ? 'all' : b.id)}
              className={chip(value === b.id)}>
              {(b.status === 'locked' || b.status === 'shot') && (
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent-blue" />
              )}
              {b.title}
              {b.clients?.name && <span className="opacity-60"> · {b.clients.name}</span>}
              <span className="tabular-nums opacity-60">{count}</span>
            </button>
          )
        })}
    </div>
  )
}
