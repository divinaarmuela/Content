'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Bell } from 'lucide-react'

/**
 * The Asana-style bell: an unread count that pulls someone to the feed.
 * Counts come from the same notification_log the emails are written to, so
 * the bell can never disagree with the inbox. Polled gently; transitions
 * also nudge it via the production realtime hint upstream (a reload of any
 * board refetches everything anyway).
 */
export default function NotificationBell() {
  const [unread, setUnread] = useState(0)

  const check = useCallback(() => {
    fetch('/api/team/notifications?count=1')
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (j && typeof j.unread === 'number') setUnread(j.unread) })
      .catch(() => { /* a missed poll is a stale badge, nothing worse */ })
  }, [])

  useEffect(() => {
    check()
    const id = window.setInterval(check, 60_000)
    const onVisible = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onVisible) }
  }, [check])

  return (
    <Link
      href="/dashboard/notifications"
      aria-label={`Notifications, ${unread} unread`}
      /* a 44px surface pill, the same shape as the theme toggle beside it —
         it is its own hit target, so nothing has to wrap it */
      className="relative inline-flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface text-foreground transition-colors hover:bg-muted"
      onClick={() => setUnread(0)}
    >
      <Bell className="h-[18px] w-[18px]" strokeWidth={1.8} />
      {unread > 0 && (
        <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-red px-1 text-[10px] font-bold tabular-nums text-cream">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </Link>
  )
}
