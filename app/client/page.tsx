'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import PortalSectionsView from '../components/portal/PortalSectionsView'
import PortalLive from '../components/portal/PortalLive'
import PortalTabbedView from '../components/portal/PortalTabbedView'
import { PortalHelpLine } from '../components/portal/PortalSections'
import { heroCounts } from '../lib/portal-core'
import type { PortalData } from '../lib/portal-data'

/** The portal components are themed by --p-* variables; inside the dashboard
 *  shell they take the dashboard's own tokens so they follow light/dark with
 *  everything else. */
const DASH_TOKENS: React.CSSProperties = {
  ['--p-bg' as string]: 'hsl(var(--background))',
  ['--p-ink' as string]: 'hsl(var(--foreground))',
  ['--p-surface' as string]: 'hsl(var(--card))',
  ['--p-border' as string]: 'hsl(var(--border))',
  ['--p-accent' as string]: 'hsl(var(--primary))',
  ['--p-accent-ink' as string]: 'hsl(var(--primary-foreground))',
}

const COUNTERS: [keyof ReturnType<typeof heroCounts>, string][] = [
  ['review', 'Needs your review'],
  ['production', 'In production'],
  ['approved', 'Approved & scheduled'],
  ['published', 'Published'],
]

/**
 * The signed-in client portal — the same page the share link shows, inside
 * the dashboard shell: the client's name and the four counters, then the
 * sections with the planning board open under each shoot. Acts through the
 * item and shoot APIs the viewer is already signed in to, and keeps itself
 * current.
 */
export default function ClientPortalPage() {
  const [data, setData] = useState<(PortalData & { viewer_role: string }) | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/portal', { cache: 'no-store' })
    if (!res.ok) {
      setError((await res.json()).error ?? 'Could not load your workspace')
      return
    }
    setData(await res.json())
  }, [])

  useEffect(() => { load() }, [load])

  if (error) {
    return (
      <Card className="border-dashed shadow-none">
        <CardContent className="py-14 text-center text-sm text-muted-foreground">{error}</CardContent>
      </Card>
    )
  }
  if (!data) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    )
  }

  const counts = heroCounts(data.cards)

  return (
    <div className="portal-legible flex flex-col gap-8" style={DASH_TOKENS}>
      <PortalLive clientId={data.client.id} onChange={load} />

      {/* the client's name and the four numbers — the hero, at dashboard size */}
      <header className="flex flex-col gap-4" data-portal-hero>
        <div className="flex flex-wrap items-center gap-3">
          {data.brand_logo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.brand_logo_url} alt="" className="h-9 w-auto max-w-[160px] object-contain" />
          )}
          <h1 className="text-[26px] font-semibold uppercase leading-tight tracking-[-0.02em] sm:text-[34px]">{data.client.name}</h1>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:flex sm:flex-wrap sm:gap-x-10">
          {COUNTERS.map(([key, label]) => (
            <div key={key} data-counter={key}>
              <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
              <p className="text-[22px] font-semibold tabular-nums" style={{ opacity: counts[key] > 0 ? 1 : 0.35 }}>
                {String(counts[key]).padStart(2, '0')}
              </p>
            </div>
          ))}
        </div>
      </header>

      {/* an intake tab appears only when a form is toggled on; with none, this
          renders the overview alone */}
      <PortalTabbedView intake={data.intake} themeStyle={DASH_TOKENS}>
        <div className="flex flex-col gap-8">
          <PortalSectionsView data={data} surface={{ loggedIn: true, onChanged: load }} />

          {/* who to reach, always visible — a portal must never dead-end */}
          <div className="border-t border-border pt-4">
            <PortalHelpLine amName={data.am_name} className="text-muted-foreground opacity-100" />
          </div>
        </div>
      </PortalTabbedView>
    </div>
  )
}
