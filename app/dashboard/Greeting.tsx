'use client'

import { useEffect, useState } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { useRole } from './useRole'
import { DEFAULT_TZ, greetingInZone } from '../lib/timezone-core'

/** Where this browser thinks it is. Null when it will not say. */
function browserZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null
  } catch {
    return null
  }
}

/**
 * Greets by the viewer's own clock — the DEVICE's, first.
 *
 * This used to read `timezone` off the team_users profile, on the theory that
 * a deliberately-set field beats a browser's guess. In practice the field held
 * its default and the browser held the truth: a scheduler working from the
 * Philippines was greeted "Working late … 09:02 pm" at seven in the evening,
 * because the profile said Melbourne and nobody had ever changed it.
 *
 * The browser is where the person actually is, travelling or not. The profile
 * is the fallback for the rare case the browser will not say, and it is kept
 * in step with the browser on sign-in, so the server-side rollups that read it
 * agree with what she sees here.
 */

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

  const zone = browserZone() || me?.timezone || DEFAULT_TZ
  const firstName = (me?.name || '').trim().split(/\s+/)[0]
  const hello = greetingInZone(now, zone)

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
