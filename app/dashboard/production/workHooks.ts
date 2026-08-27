'use client'

import { useCallback, useEffect, useState } from 'react'
import { defaultScope, type ScopeMode, type ScopeSet } from '../../lib/work-pages-core'
import type { Role } from '../../lib/identity-core'

/**
 * The two things all three work pages need and none of them owns.
 *
 * Editor, Scheduler and Production each carried a verbatim copy of the scope
 * restore and the manager-only team fetch. Three copies of a rule is three
 * places to fix it — and the scope restore in particular has a subtlety worth
 * stating once (see below) rather than re-deriving twice.
 */

const isScopeMode = (v: unknown): v is ScopeMode =>
  v === 'mine' || v === 'unassigned' || v === 'all'

/**
 * The scope this viewer last chose on this page, remembered between visits.
 *
 * Whatever is in storage is a guess, not a fact — an old key, a hand-edit, a
 * mode we have since renamed. Keep the words we still understand; if that
 * leaves nothing, open where this role would have opened anyway.
 *
 * The read happens in an effect, not during render: these pages prerender, and
 * touching localStorage while the server is drawing them is both a crash and a
 * hydration mismatch. Until the role is known the caller is showing its own
 * loading state, so the value returned in the meantime is never on screen.
 */
export function usePersistedScope(key: string, role: Role | null): [ScopeSet, (s: ScopeSet) => void] {
  const [stored, setStored] = useState<ScopeSet | null>(null)

  useEffect(() => {
    if (role === null || stored !== null) return
    try {
      const saved = localStorage.getItem(key)
      const parsed: unknown = saved ? JSON.parse(saved) : null
      const restored = Array.isArray(parsed) ? parsed.filter(isScopeMode) : []
      if (restored.length > 0) { setStored(new Set(restored)); return }
    } catch { /* a corrupt or blocked localStorage is not worth a broken page */ }
    setStored(defaultScope(role))
  }, [key, role, stored])

  const setScope = useCallback((s: ScopeSet) => {
    setStored(s)
    try { localStorage.setItem(key, JSON.stringify([...s])) } catch { /* private mode */ }
  }, [key])

  // 'scheduler' is the least privileged team role: if the caller ever does
  // render this, it shows own-work-only rather than everyone's
  return [stored ?? defaultScope(role ?? 'scheduler'), setScope]
}

/**
 * A choice from a fixed set, remembered between visits — Board vs Calendar,
 * month vs week, a layer switched on.
 *
 * Same shape and same caution as the scope above: whatever is in storage is a
 * guess, so a word we no longer understand falls back to the default rather
 * than putting the page into a state it cannot draw. The read is in an effect
 * because these pages prerender, and touching localStorage while the server
 * is rendering is both a crash and a hydration mismatch.
 */
export function usePersistedChoice<T extends string>(
  key: string, allowed: readonly T[], fallback: T,
): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(fallback)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(key)
      if (saved && (allowed as readonly string[]).includes(saved)) setValue(saved as T)
    } catch { /* a blocked localStorage is not worth a broken page */ }
    // `allowed` is a literal at every call site; keying on its contents keeps
    // an inline array from re-running this on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, allowed.join(',')])

  const set = useCallback((v: T) => {
    setValue(v)
    try { localStorage.setItem(key, v) } catch { /* private mode */ }
  }, [key])

  return [value, set]
}

/** On/off, remembered — a layer toggle is not a three-way choice. */
export function usePersistedFlag(key: string, fallback = false): [boolean, (v: boolean) => void] {
  const [value, set] = usePersistedChoice(key, ['on', 'off'] as const, fallback ? 'on' : 'off')
  return [value === 'on', useCallback((v: boolean) => set(v ? 'on' : 'off'), [set])]
}

/**
 * id → display name for the people who can carry a job.
 *
 * `/api/team` is manager-gated, so this is asked for only when the viewer is
 * one; everyone else gets an empty map and the surfaces say what is true
 * without naming anybody. Clients never carry a task and neither do
 * deactivated accounts, so neither is in here.
 */
export function useTeamNames(enabled: boolean): Map<string, string> {
  const [names, setNames] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    if (!enabled) { setNames(new Map()); return }
    let cancelled = false
    fetch('/api/team')
      .then(r => (r.ok ? r.json() : { members: [] }))
      .then((json: { members?: { id: string; name: string; email: string; role: string; active_status?: boolean }[] }) => {
        if (cancelled) return
        setNames(new Map(
          (json.members ?? [])
            .filter(m => m.role !== 'client' && m.active_status !== false)
            .map(m => [m.id, m.name || m.email]),
        ))
      })
      .catch(() => { if (!cancelled) setNames(new Map()) })
    return () => { cancelled = true }
  }, [enabled])

  return names
}
