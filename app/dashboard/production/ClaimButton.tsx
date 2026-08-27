'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

/**
 * "I'll take this one."
 *
 * Lives inside a card that is itself a <Link>, so the click has to be stopped
 * dead before the navigation starts. Losing the race is a normal outcome, not
 * an error state: the server names whoever got there first and the board
 * reloads so the card simply moves on.
 */
export function ClaimButton({ itemId, hat, label, onDone }: {
  itemId: string
  hat: 'editor' | 'scheduler'
  label: string
  /** the board's own reload. AWAITED: the button stays busy until the list it
   *  sits in has actually caught up, so a card that should have moved on is
   *  never left under a toast saying it did. */
  onDone: () => void | Promise<void>
}) {
  const [busy, setBusy] = useState(false)

  const claim = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/production/items/${itemId}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hat }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) toast.error(json?.error ?? 'Could not pick this up')
      else toast.success(hat === 'editor' ? "It's yours" : "You're scheduling this")
      await onDone()
    } catch {
      toast.error('Could not pick this up — please try again')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button size="sm" variant="outline" disabled={busy} onClick={claim}>
      {busy ? 'Taking…' : label}
    </Button>
  )
}
