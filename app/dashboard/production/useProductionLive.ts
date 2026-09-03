'use client'

import { useCallback } from 'react'
import { useLive } from '@/lib/db-client'

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
 * Changes are hints, never data: the callback should refetch through its own
 * authenticated API so all role/client scoping is re-applied server-side.
 * Includes the standard belt-and-braces fallback — a visibility-aware 60s
 * poll that also fires the moment the tab comes back into view, covering
 * dropped sockets and sleeping laptops.
 *
 * Keep `onChange` referentially stable (useCallback) or the effects rewire on
 * every render.
 */
export function useProductionLive(
  onChange: (change?: ProductionChange) => void,
  opts?: { pollMs?: number },
) {
  const handler = useCallback((hint: Record<string, unknown> & { ts: number }) => {
    onChange(hint.item_id ? (hint as unknown as ProductionChange) : undefined)
  }, [onChange])
  useLive('production', handler, opts)
}
