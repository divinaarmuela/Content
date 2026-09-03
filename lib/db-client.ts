'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { getApp, getApps, initializeApp } from 'firebase/app'
import { getDatabase, ref, query, orderByChild, equalTo, onValue, type Query } from 'firebase/database'
import { firebaseConfig } from './firebase-config'
import { NULLABLE_COLUMNS, type Row, type TableName } from './db-types'
import { pickPushdown } from './db-indexes'
import type { LiveChannel } from './live'

/**
 * Live reads straight from Realtime Database in the browser: the board
 * renders from a snapshot and re-renders the instant anyone changes a row.
 * Writes still go through the API routes, which own side effects.
 */

function db() {
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig())
  return getDatabase(app)
}

export function snapshotToRows<T>(name: TableName, val: Record<string, any> | null): T[] {
  if (!val) return []
  const nullable = NULLABLE_COLUMNS[name] ?? []
  return Object.entries(val).map(([id, r]) => {
    const row: any = { ...r, id: r?.id ?? id }
    for (const c of nullable) if (row[c] === undefined) row[c] = null
    return row as T
  })
}

export type ClientQuery<T> = { where?: (r: T) => boolean; orderBy?: [keyof T & string, 'asc' | 'desc'][]; limit?: number }

export function applyQuery<T>(rows: T[], q: ClientQuery<T>): T[] {
  let out = q.where ? rows.filter(q.where) : rows.slice()
  if (q.orderBy?.length) {
    const ob = q.orderBy
    out.sort((a: any, b: any) => {
      for (const [col, dir] of ob) {
        const x = a[col], y = b[col]
        if (x === y) continue
        if (x == null) return 1
        if (y == null) return -1
        return (x < y ? -1 : 1) * (dir === 'desc' ? -1 : 1)
      }
      return 0
    })
  }
  if (q.limit != null) out = out.slice(0, q.limit)
  return out
}

/**
 * `where`/`orderBy` run inside a `useMemo` keyed on their identity, so pass
 * referentially stable callbacks/arrays (`useCallback`/`useMemo` at the call
 * site) — a fresh arrow function every render defeats the memo and, worse,
 * re-subscribes nothing (the live listener doesn't depend on them) but still
 * re-sorts/re-filters every render.
 */
export function useTable<T extends Row>(
  name: TableName,
  opts: ClientQuery<T> & { by?: Partial<T>; enabled?: boolean } = {},
) {
  const [raw, setRaw] = useState<Record<string, any> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const byKey = opts.by ? JSON.stringify(opts.by) : ''
  const enabled = opts.enabled ?? true

  useEffect(() => {
    if (!enabled) { setLoading(false); return }
    let q: Query = ref(db(), `/mdm/tables/${name}`)
    const by = byKey ? (JSON.parse(byKey) as Record<string, unknown>) : null
    // Only push a key down as an orderBy/equalTo query when it is a declared
    // indexed column — an unindexed query 400s against the real database
    // the moment rules are enforced. Mirrors lib/db.ts's readAll exactly.
    const pushed = pickPushdown(by)
    if (pushed) q = query(q, orderByChild(pushed.key), equalTo(pushed.value as string | number | boolean))
    setLoading(true)
    const off = onValue(q, snap => { setRaw(snap.val()); setLoading(false); setError(null) }, e => { setError(e.message); setLoading(false) })
    return off
  }, [name, byKey, enabled])

  const rows = useMemo(() => {
    let r = snapshotToRows<T>(name, raw)
    const by = byKey ? (JSON.parse(byKey) as Record<string, unknown>) : null
    if (by) {
      // Filter in memory every `by` key EXCEPT the one actually pushed down
      // as a query above (matched by key name, not position) — including a
      // pushdown-eligible key whose value happened to be null/undefined,
      // which was never sent to the server as a query in the first place.
      const pushed = pickPushdown(by)
      const entries = Object.entries(by).filter(([k]) => k !== pushed?.key)
      if (entries.length) r = r.filter((row: any) => entries.every(([k, v]) => (v == null ? row[k] == null : row[k] === v)))
    }
    return applyQuery(r, opts)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, name, byKey, opts.where, opts.orderBy, opts.limit])

  return { rows, loading, error }
}

export function useRow<T extends Row>(name: TableName, id: string | null | undefined) {
  const [row, setRow] = useState<T | null>(null)
  const [loading, setLoading] = useState(Boolean(id))
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!id) { setRow(null); setLoading(false); setError(null); return }
    setLoading(true)
    // Without the error callback a listener that is refused or drops never
    // calls back at all: `loading` stays true and the page spins forever.
    return onValue(ref(db(), `/mdm/tables/${name}/${id}`), snap => {
      const v = snap.val()
      setRow(v ? snapshotToRows<T>(name, { [id]: v })[0] : null)
      setLoading(false)
      setError(null)
    }, e => { setError(e.message); setLoading(false) })
  }, [name, id])
  return { row, loading, error }
}

/**
 * Subscribe to a change marker. Same contract as the old Inngest hook: the
 * callback refetches through its own authenticated API. Includes the
 * visibility-aware poll so a dropped socket or a sleeping laptop still
 * catches up. Keep `onChange` referentially stable (useCallback).
 */
export function useLive(channel: LiveChannel, onChange: (hint: Record<string, unknown> & { ts: number }) => void, opts?: { pollMs?: number }) {
  const lastTs = useRef(0)
  useEffect(() => {
    return onValue(ref(db(), `/mdm/live/${channel}`), snap => {
      const v = snap.val() as (Record<string, unknown> & { ts: number }) | null
      if (!v?.ts || v.ts === lastTs.current) return
      const first = lastTs.current === 0
      lastTs.current = v.ts
      if (!first) onChange(v)  // the initial snapshot is history, not news
    })
  }, [channel, onChange])
  useEffect(() => {
    const tick = () => { if (!document.hidden) onChange({ ts: Date.now() }) }
    const id = window.setInterval(tick, opts?.pollMs ?? 60_000)
    document.addEventListener('visibilitychange', tick)
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', tick) }
  }, [onChange, opts?.pollMs])
}
