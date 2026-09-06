'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useLive } from '@/lib/db-client'

/**
 * THE PORTAL UPDATES BY ITSELF.
 *
 * A comment from the team, a card moving, a board card added or moved, a link
 * replaced — the portal shows it without a reload. The dashboard already
 * announces every such change on `/mdm/live/production` (lib/live.ts):
 * `{ item_id | batch:id, client_id, status, kind, ts }` — a HINT that
 * something changed, never the data. This listens to that one marker,
 * ignores other clients' hints, and on a hint for this client re-renders the
 * page in place (`router.refresh()`, or the signed-in page's own reload) —
 * so every byte the client sees still passes through portal-data's
 * sanitising on the server. Nothing is read from the raw tables here.
 *
 * Debounced: a save that announces twice refreshes once. Scroll position and
 * open threads survive a refresh — it is a re-render, not a navigation.
 *
 * What a browser on the portal can see from this subscription: the single
 * latest hint on the channel — an item or shoot id, a client id, a status
 * word and a timestamp — for whichever client changed last. No titles, no
 * captions, no links, no comments.
 */
export default function PortalLive({ clientId, onChange, debounceMs = 300 }: {
  clientId: string
  /** the signed-in page reloads its own data; the share link re-renders */
  onChange?: () => void
  debounceMs?: number
}) {
  const router = useRouter()
  const timer = useRef<number | null>(null)
  const pending = useRef<(() => void) | null>(null)
  pending.current = onChange ?? null

  const fire = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      timer.current = null
      if (pending.current) pending.current()
      else router.refresh()
    }, debounceMs)
  }, [router, debounceMs])

  const handler = useCallback((hint: Record<string, unknown> & { ts: number }) => {
    // a hint names its client; the poll's own tick names none and is a check
    const hinted = typeof hint.client_id === 'string' ? hint.client_id : null
    if (hinted && hinted !== clientId) return
    fire()
  }, [clientId, fire])

  useLive('production', handler, { pollMs: 120_000 })

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current) }, [])
  return null
}
