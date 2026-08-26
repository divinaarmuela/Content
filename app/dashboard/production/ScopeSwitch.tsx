'use client'

import type { ScopeMode, ScopeSet } from '../../lib/work-pages-core'

/**
 * Mine · Unassigned · Everyone.
 *
 * The whole point of the three work pages: you open on your own work and the
 * pool nobody has picked up, and you go looking for everyone else's only when
 * you mean to. Mine and Unassigned are a pair you can wear together; Everyone
 * replaces both. One is always on — an empty board with no filter showing is
 * a bug report waiting to happen.
 */
export function ScopeSwitch({ scope, onChange, unassignedCount, unassignedHint }: {
  scope: ScopeSet
  onChange: (s: ScopeSet) => void
  unassignedCount?: number
  unassignedHint?: string
}) {
  const toggle = (key: Exclude<ScopeMode, 'all'>) => {
    const next = new Set(scope)
    next.delete('all')
    if (next.has(key)) next.delete(key)
    else next.add(key)
    // never leave nothing selected — the last pill standing stays on
    if (next.size === 0) next.add(key)
    onChange(next)
  }

  const pill = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-sm transition-colors ${
      active
        ? 'bg-white font-medium text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-100'
        : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
    }`

  return (
    <div role="group" aria-label="Scope"
      className="flex items-center gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800/60">
      <button type="button" aria-pressed={scope.has('mine')} className={pill(scope.has('mine'))}
        onClick={() => toggle('mine')}>
        Mine
      </button>
      <button type="button" aria-pressed={scope.has('unassigned')} className={pill(scope.has('unassigned'))}
        title={unassignedHint} onClick={() => toggle('unassigned')}>
        Unassigned
        {unassignedCount !== undefined && unassignedCount > 0 && (
          <span className="ml-1.5 rounded-full bg-zinc-200 px-1.5 py-px font-mono text-[10px] tabular-nums text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
            {unassignedCount}
          </span>
        )}
      </button>
      <button type="button" aria-pressed={scope.has('all')} className={pill(scope.has('all'))}
        onClick={() => onChange(new Set<ScopeMode>(['all']))}>
        Everyone
      </button>
    </div>
  )
}
