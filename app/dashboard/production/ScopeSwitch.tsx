'use client'

import type { ScopeMode, ScopeSet } from '../../lib/work-pages-core'

/**
 * Showing: Mine · Free to take · Everyone's.
 *
 * The whole point of the three work pages: you open on your own work and the
 * pool nobody has picked up, and you go looking for everyone else's only when
 * you mean to. Mine and Free to take are a PAIR you can wear together;
 * Everyone's replaces both. One is always on — an empty board with no filter
 * showing is a bug report waiting to happen.
 *
 * That pair is why this is not a one-of-three segmented control, and it used
 * to be invisible: the only explanation was a `title` tooltip, which does not
 * exist on a tablet and is never read aloud. Now the group is labelled, the
 * two that combine sit inside their own bracket, and the hint is a line on
 * the page rather than something you have to hover to find.
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

  const both = scope.has('mine') && scope.has('unassigned')

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">
          Showing
        </span>
        <div role="group" aria-label="Which work to show"
          className="flex items-center gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800/60">
          <button type="button" aria-pressed={scope.has('mine')} className={pill(scope.has('mine'))}
            onClick={() => toggle('mine')}>
            Mine
          </button>
          <span className="text-[10px] text-zinc-400 dark:text-zinc-500">+</span>
          <button type="button" aria-pressed={scope.has('unassigned')} className={pill(scope.has('unassigned'))}
            onClick={() => toggle('unassigned')}>
            Free to take
            {unassignedCount !== undefined && unassignedCount > 0 && (
              <span className="ml-1.5 rounded-full bg-zinc-200 px-1.5 py-px font-mono text-[10px] tabular-nums text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                {unassignedCount}
              </span>
            )}
          </button>
          <span className="mx-1 h-4 w-px bg-zinc-300 dark:bg-zinc-700" />
          <button type="button" aria-pressed={scope.has('all')} className={pill(scope.has('all'))}
            onClick={() => onChange(new Set<ScopeMode>(['all']))}>
            Everyone&rsquo;s
          </button>
        </div>
      </div>
      <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
        {scope.has('all')
          ? 'Everything, whoever is on it.'
          : both
            ? 'Your own work plus anything nobody has taken. Tap either to narrow it.'
            : scope.has('mine')
              ? 'Only what is assigned to you.'
              : unassignedHint ?? 'Only work nobody has taken yet.'}
      </p>
    </div>
  )
}
