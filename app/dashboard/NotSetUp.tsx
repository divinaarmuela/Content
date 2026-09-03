'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { AlertTriangle, LifeBuoy, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  notSetUpMessage, loadFailedMessage, techMailto,
} from '@/app/lib/support-core'

/**
 * The two states that used to be printed as developer notes.
 *
 * <NotSetUp>   — the feature's database or integration has never been switched
 *                on for this workspace. Nothing the person can do; nothing they
 *                did wrong.
 * <LoadFailed> — it IS switched on and this attempt failed. Distinct from
 *                "nothing here yet", which is what an outage used to look like.
 *
 * Both keep the technical string: it goes to console.error for whoever opens
 * devtools, and into the body of the support email — never onto the screen.
 */

function TellTech({ subject, detail }: { subject: string; detail?: string | null }) {
  const path = usePathname()
  return (
    <Button variant="outline" size="sm" asChild>
      <a href={techMailto({ subject, detail, page: path })}>
        <LifeBuoy className="h-4 w-4" /> Tell MD Media tech
      </a>
    </Button>
  )
}

export function NotSetUp({ feature, detail, className }: {
  /** the name the person sees in the nav — "Leads", "Bookings" */
  feature: string
  /** the developer string we are hiding. Logged, mailed, never rendered. */
  detail?: string | null
  className?: string
}) {
  useEffect(() => {
    if (detail) console.error(`[${feature}] not set up:`, detail)
  }, [feature, detail])

  return (
    <div className={`mx-auto flex max-w-md flex-col items-center gap-3 rounded-inner border border-dashed border-border px-6 py-14 text-center ${className ?? ''}`}>
      <AlertTriangle className="h-6 w-6 text-accent-amber" />
      <p className="text-body-15 font-medium">{feature} isn&apos;t switched on yet</p>
      <p className="max-w-sm text-secondary-13 leading-relaxed text-muted-foreground">
        {notSetUpMessage(feature)}
      </p>
      <TellTech subject={`${feature} isn't switched on`} detail={detail} />
    </div>
  )
}

export function LoadFailed({ what, detail, onRetry, className }: {
  /** what failed to load, lower case and in the person's words — "your leads" */
  what: string
  detail?: string | null
  onRetry?: () => void
  className?: string
}) {
  useEffect(() => {
    if (detail) console.error(`[load failed] ${what}:`, detail)
  }, [what, detail])

  return (
    <div className={`flex flex-col items-center gap-3 rounded-inner border border-dashed border-border px-6 py-12 text-center ${className ?? ''}`}>
      <AlertTriangle className="h-5 w-5 text-accent-amber" />
      <p className="text-body-15 font-medium">We couldn&apos;t load {what}</p>
      <p className="max-w-sm text-secondary-13 leading-relaxed text-muted-foreground">
        {loadFailedMessage(what)}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw className="h-4 w-4" /> Try again
          </Button>
        )}
        <TellTech subject={`Couldn't load ${what}`} detail={detail} />
      </div>
    </div>
  )
}
