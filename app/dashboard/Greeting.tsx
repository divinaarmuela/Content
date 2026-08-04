'use client'

import { useEffect, useState } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { useRole } from './useRole'

/**
 * Greets by the viewer's own clock.
 *
 * The hour comes from their `timezone` on team_users — the same field the
 * Team Activity rollup uses to decide what is overdue — not from the browser.
 * Those usually agree, but when someone is travelling or a contractor works
 * from another country, the browser is the wrong answer and their profile is
 * the one they set deliberately.
 */
function partOfDay(hour: number): string {
  if (hour < 5) return 'Still up'
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  if (hour < 21) return 'Good evening'
  return 'Working late'
}

/** Hour of day in a given zone, falling back to the browser if it is invalid. */
function hourIn(zone: string, now: Date): number {
  try {
    return Number(
      new Intl.DateTimeFormat('en-AU', { timeZone: zone, hour: 'numeric', hour12: false }).format(now),
    )
  } catch {
    return now.getHours()
  }
}

export default function Greeting({ subtitle }: { subtitle: string }) {
  const { me, loading } = useRole()
  const [now, setNow] = useState(() => new Date())

  // ticks so the greeting and clock stay honest on a page left open
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-80" />
      </div>
    )
  }

  const zone = me?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
  const firstName = (me?.name || '').trim().split(/\s+/)[0]
  const hello = partOfDay(hourIn(zone, now))

  let clock = ''
  try {
    clock = new Intl.DateTimeFormat('en-AU', {
      timeZone: zone, weekday: 'long', day: 'numeric', month: 'long',
      hour: '2-digit', minute: '2-digit',
    }).format(now)
  } catch { /* an invalid zone just drops the clock line */ }

  return (
    <div>
      <h2 className="text-lg font-semibold tracking-tight">
        {firstName ? `${hello}, ${firstName}` : hello}
      </h2>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        {clock && <span className="tabular-nums">{clock}</span>}
        {clock && ' · '}
        {subtitle}
      </p>
    </div>
  )
}
