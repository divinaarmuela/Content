'use client'

import type { BatchStatus } from '../../lib/batch-brief-core'
import type { Batch } from './NewItemDialog'

/** Status badge classes shared by the shoots view, brief page, and board chips. */
export const BATCH_STATUS_STYLE: Record<BatchStatus, string> = {
  brief: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400',
  locked: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-400',
  shot: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-400',
  wrapped: 'border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400',
}

export const BATCH_STATUS_LABEL: Record<BatchStatus, string> = {
  brief: 'In planning', locked: 'Date locked', shot: 'Shot', wrapped: 'Wrapped',
}

/** Priority flag colour. One copy, worn by every work card. */
export const PRIORITY_TINT: Record<string, string> = {
  urgent: 'text-red-600 dark:text-red-400',
  high: 'text-amber-600 dark:text-amber-400',
  normal: 'text-zinc-400 dark:text-zinc-500',
  low: 'text-zinc-300 dark:text-zinc-600',
}

/** The little pill naming a work kind. */
export const KIND_CHIP: Record<string, string> = {
  zinc: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  pink: 'bg-pink-100 text-pink-700 dark:bg-pink-950/50 dark:text-pink-400',
  sky: 'bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-400',
  indigo: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-400',
  violet: 'bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-400',
  emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400',
  rose: 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-400',
}

/** Card face per work kind — a coloured edge and a faint wash, so a column
 *  full of mixed work reads at a glance instead of as plain white cards. */
export const KIND_CARD: Record<string, string> = {
  zinc: '',
  pink: 'border-l-2 border-l-pink-400 bg-pink-50/40 dark:bg-pink-950/20',
  sky: 'border-l-2 border-l-sky-400 bg-sky-50/40 dark:bg-sky-950/20',
  indigo: 'border-l-2 border-l-indigo-400 bg-indigo-50/40 dark:bg-indigo-950/20',
  violet: 'border-l-2 border-l-violet-400 bg-violet-50/40 dark:bg-violet-950/20',
  emerald: 'border-l-2 border-l-emerald-400 bg-emerald-50/40 dark:bg-emerald-950/20',
  amber: 'border-l-2 border-l-amber-400 bg-amber-50/40 dark:bg-amber-950/20',
  rose: 'border-l-2 border-l-rose-400 bg-rose-50/40 dark:bg-rose-950/20',
}

const chip = (active: boolean) =>
  `rounded-full border px-2.5 py-1 text-xs transition-colors ${
    active
      ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
      : 'border-zinc-200 text-zinc-500 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100'
  }`

/**
 * The shoot chips above a board.
 *
 * Shoots exist as first-class things, not just a dropdown inside the create
 * dialog — a new one appears here immediately, and clicking it narrows the
 * board to that shoot's items. Clicking the chip that is already on clears it.
 */
export function ShootChips({ batches, clientFilter, value, onChange }: {
  batches: Batch[]
  clientFilter: string
  value: string
  onChange: (batchId: string) => void
}) {
  if (batches.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">
        Shoots
      </span>
      <button type="button" onClick={() => onChange('all')} className={chip(value === 'all')}>
        All
      </button>
      {batches
        .filter(b => (b.status ?? 'shot') !== 'brief')
        .filter(b => clientFilter === 'all' || b.client_id === clientFilter)
        .map(b => {
          const count = b.content_items?.[0]?.count ?? 0
          return (
            <button key={b.id} type="button"
              onClick={() => onChange(value === b.id ? 'all' : b.id)}
              className={chip(value === b.id)}>
              {(b.status === 'locked' || b.status === 'shot') && (
                <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${b.status === 'locked' ? 'bg-sky-500' : 'bg-violet-500'}`} />
              )}
              {b.title}
              {b.clients?.name && <span className="opacity-60"> · {b.clients.name}</span>}
              <span className="ml-1 font-mono tabular-nums opacity-60">{count}</span>
            </button>
          )
        })}
    </div>
  )
}
