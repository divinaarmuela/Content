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
      className="relative inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
      onClick={() => setUnread(0)}
    >
      <Bell className="h-4 w-4" />
      {unread > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 font-mono text-[10px] tabular-nums text-white">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </Link>
  )
}
