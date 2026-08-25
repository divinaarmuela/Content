'use client'

import { useEffect, useState } from 'react'

/**
 * How long the seat is held, and what to do when it isn't any more.
 *
 * Without this a customer who steps away comes back to a payment form that
 * silently no longer works — and if someone took the slot meanwhile, no way
 * to find that out except by trying. A countdown sets the expectation, and
 * expiry hands them straight back to a fresh list of times.
 */
export default function HoldTimer({
  expiresAt, onExpired, tone = 'dark',
}: {
  /** unix seconds, from Stripe's session */
  expiresAt: number | null
  onExpired: () => void
  tone?: 'dark' | 'event'
}) {
  const [left, setLeft] = useState<number | null>(null)

  useEffect(() => {
    if (!expiresAt) return
    const tick = () => {
      const secs = Math.max(0, Math.floor(expiresAt - Date.now() / 1000))
      setLeft(secs)
      if (secs === 0) onExpired()
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [expiresAt, onExpired])

  const dim = tone === 'event' ? 'rgba(255,255,255,0.55)' : undefined
  if (left === null) {
    return (
      <p className="text-[11px] uppercase tracking-[0.16em]" style={{ opacity: 0.55, color: dim }}>
        Your time is held while you pay
      </p>
    )
  }
  const m = Math.floor(left / 60)
  const s = String(left % 60).padStart(2, '0')
  const urgent = left < 300
  return (
    <p className="text-[11px] uppercase tracking-[0.16em]"
      style={{ opacity: urgent ? 1 : 0.55, color: urgent ? '#f59e0b' : dim }}>
      Time held · {m}:{s} left
    </p>
  )
}
