'use client'

import { useState } from 'react'
import { ShieldCheck, ChevronDown } from 'lucide-react'

/**
 * The transparency notice.
 *
 * BUILD_PLAN §3.3 requires this to ship *inside* phase 1, not after it — the
 * whole justification for building this rather than buying a tracker is that
 * nothing here is invisible to the people it describes. So it is placed above
 * the data, always rendered, and cannot be permanently dismissed: collapsing
 * it is a convenience, and the one-line summary stays on screen either way.
 */
export default function TransparencyNotice() {
  const [open, setOpen] = useState(false)

  return (
    <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex w-full items-start gap-3 rounded-lg px-4 py-3 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
      >
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">
            What this page collects
          </span>
          <span className="mt-0.5 block text-sm text-zinc-500 dark:text-zinc-400">
            Task activity from Asana only. No screenshots, no keystrokes, nothing running on your
            device — and you can always see your own data.
          </span>
        </span>
        <ChevronDown
          className={`mt-0.5 h-4 w-4 shrink-0 text-zinc-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <dl className="grid gap-x-8 gap-y-4 border-t border-zinc-100 px-4 py-4 text-sm sm:grid-cols-2 dark:border-zinc-800">
          <div>
            <dt className="font-mono text-[11px] uppercase tracking-[0.14em] text-zinc-400">Collected</dt>
            <dd className="mt-1 text-zinc-600 dark:text-zinc-400">
              Asana events on tracked projects — task created, assigned, completed, due date changed —
              with who did it and when. Plus the current state of tasks assigned to you.
            </dd>
          </div>
          <div>
            <dt className="font-mono text-[11px] uppercase tracking-[0.14em] text-zinc-400">Never collected</dt>
            <dd className="mt-1 text-zinc-600 dark:text-zinc-400">
              Screenshots, keystrokes, browsing, idle time, location, or anything from your machine.
              No agent is installed anywhere.
            </dd>
          </div>
          <div>
            <dt className="font-mono text-[11px] uppercase tracking-[0.14em] text-zinc-400">Who sees it</dt>
            <dd className="mt-1 text-zinc-600 dark:text-zinc-400">
              You see your own row. Super admins see the team. Clients never have access to this page.
            </dd>
          </div>
          <div>
            <dt className="font-mono text-[11px] uppercase tracking-[0.14em] text-zinc-400">Why</dt>
            <dd className="mt-1 text-zinc-600 dark:text-zinc-400">
              So work in progress is visible in one place instead of scattered across Asana projects —
              for planning and workload balance, not for individual performance scoring.
            </dd>
          </div>
        </dl>
      )}
    </div>
  )
}
