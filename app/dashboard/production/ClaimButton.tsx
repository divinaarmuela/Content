'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

/**
 * "Take this" — the one verb for picking up a job, on every page.
 *
 * Four different labels used to say it ("Take this job", "Take this task",
 * "I'll schedule this", "Up for grabs"), so a person who learned one did not
 * recognise the next. Now the button says the same two words everywhere and
 * the toast says what changed and where the job is.
 *
 * Lives inside a card that is itself a <Link>, so the click has to be stopped
 * dead before the navigation starts. Losing the race is a normal outcome, not
 * an error state: the server names whoever got there first and the board
 * reloads so the card simply moves on.
 */
export function ClaimButton({ itemId, hat, label = 'Take this', onDone, variant = 'default' }: {
  itemId: string
  hat: 'editor' | 'scheduler'
  label?: string
  /** the board's own reload. AWAITED: the button stays busy until the list it
   *  sits in has actually caught up, so a card that should have moved on is
   *  never left under a toast saying it did. */
  onDone: () => void | Promise<void>
  variant?: 'default' | 'outline'
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
      if (!res.ok) toast.error(json?.error ?? 'Could not take this on')
      // one confirmation for one action, and where it now lives: "Mine"
      // is the scope pill it just moved under
      else toast.success(hat === 'scheduler'
        ? 'It’s yours to schedule — it is under Mine now'
        : 'It’s yours — it is under Mine now', {
        action: { label: 'Open', onClick: () => { window.location.href = `/dashboard/production/${itemId}` } },
      })
      await onDone()
    } catch {
      toast.error('Could not take this on — please try again')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button size="sm" variant={variant} className="min-h-11 md:min-h-8" disabled={busy} onClick={claim}>
      {busy ? 'Taking…' : label}
    </Button>
  )
}
