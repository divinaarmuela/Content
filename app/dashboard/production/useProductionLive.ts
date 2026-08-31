'use client'

import { useEffect, useRef } from 'react'
import { useRealtime } from 'inngest/react'
import { productionChannel } from '../../inngest/channels'
import { fetchProductionSubscriptionToken } from './actions'

export type ProductionChange = {
  item_id: string
  client_id: string
  status: string
  kind: string
  ts: number
}

/**
 * Subscribe to the production stream and call `onChange` once per change —
 * the Firebase-snapshot feel: any open board, queue, calendar, overview, or
 * item page refetches itself the moment anyone moves an item.
 *
 * Messages are hints, never data: the callback should refetch through its own
 * authenticated API so all role/client scoping is re-applied server-side.
 * Includes the standard belt-and-braces fallback — a visibility-aware 60s
 * poll that also fires the moment the tab comes back into view, covering
 * dropped sockets and sleeping laptops.
 *
 * Keep `onChange` referentially stable (useCallback) or the effects rewire on
 * every render.
 */
/** Same-tab signal, for a change this browser made itself.
 *
 *  The realtime channel is announced by the workflow, so a change made through
 *  a path that does not transition an item — publishing an ad-hoc post, say —
 *  reaches the open views only on the 60s poll. That is a minute of a screen
 *  showing a queue the person just changed. This closes it for the tab that
 *  did it, without pretending to be a server announcement: other tabs still
 *  learn about it the way they always did. */
const LOCAL_CHANGE = 'md:production-changed'

export function notifyProductionChange(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(LOCAL_CHANGE))
}

export function useProductionLive(
  onChange: (change?: ProductionChange) => void,
  opts?: { pollMs?: number },
) {
  const { messages } = useRealtime({
    channel: productionChannel,
    topics: ['changed'] as const,
    token: () => fetchProductionSubscriptionToken(),
    // fan-out channel: it never "completes", so do not auto-close
    autoCloseOnTerminal: false,
    historyLimit: 20,
  })

  // the publish path outside a function is not retry-safe, so a duplicate
  // announcement is expected rather than exceptional — dedupe on (item, ts)
  const seen = useRef<Set<string>>(new Set())
  useEffect(() => {
    const latest = messages.last
    if (!latest) return
    const d = latest.data as ProductionChange
    if (!d?.item_id) return
    const key = `${d.item_id}:${d.ts}`
    if (seen.current.has(key)) return
    seen.current.add(key)
    if (seen.current.size > 200) seen.current.clear()
    onChange(d)
  }, [messages.last, onChange])

  useEffect(() => {
    const fn = () => onChange()
    window.addEventListener(LOCAL_CHANGE, fn)
    return () => window.removeEventListener(LOCAL_CHANGE, fn)
  }, [onChange])

  useEffect(() => {
    const tick = () => { if (!document.hidden) onChange() }
    const id = window.setInterval(tick, opts?.pollMs ?? 60_000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [onChange, opts?.pollMs])
}
