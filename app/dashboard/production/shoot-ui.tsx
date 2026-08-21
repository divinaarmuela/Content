'use client'

import Link from 'next/link'
import type { BatchStatus } from '../../lib/batch-brief-core'

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

/** The two-pill Board / Shoots switcher, shared idiom with the batch chips. */
export function ViewSwitch({ current }: { current: 'board' | 'shoots' }) {
  return (
    <div className="flex items-center gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800/60">
      {([['board', 'Board', '/dashboard/production'], ['shoots', 'Shoots', '/dashboard/production/shoots']] as const)
        .map(([key, label, href]) => (
          <Link key={key} href={href}
            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
              current === key
                ? 'bg-white font-medium text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
            }`}>
            {label}
          </Link>
        ))}
    </div>
  )
}
