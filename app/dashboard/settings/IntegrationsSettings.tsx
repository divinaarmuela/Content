'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ArrowRight } from 'lucide-react'

type Integration = {
  key: string
  name: string
  detail: string
  connected: boolean
  configured: boolean
  status: string
  href: string | null
}

/**
 * Real connection state, measured rather than declared.
 *
 * This replaced a hardcoded list that marked Instagram and Google Drive
 * "connected" regardless — worse than showing nothing, because it answered the
 * question wrongly and with confidence. Three states are distinguished: live,
 * set up but idle, and not configured, because "no API key" and "key set but
 * nothing connected" need completely different actions.
 */
export default function IntegrationsSettings() {
  const [items, setItems] = useState<Integration[] | null>(null)

  useEffect(() => {
    fetch('/api/team/integrations')
      .then(async r => {
        const j = await r.json()
        if (!r.ok) throw new Error(j.error ?? 'Could not load integrations')
        return j
      })
      .then(setItems)
      .catch(e => { toast.error(e.message); setItems([]) })
  }, [])

  if (!items) return <Skeleton className="h-80 w-full" />

  return (
    <Card className="border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <CardHeader>
        <CardTitle className="text-base">Integrations</CardTitle>
        <CardDescription>
          What this workspace is actually connected to, checked live.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col">
        {items.map((it, i) => {
          const dot = it.connected
            ? 'bg-emerald-500'
            : it.configured
              ? 'bg-amber-500'
              : 'bg-zinc-300 dark:bg-zinc-600'
          return (
            <div
              key={it.key}
              className={`flex flex-wrap items-center gap-3 py-4 ${
                i > 0 ? 'border-t border-zinc-100 dark:border-zinc-800' : ''
              }`}
            >
              {/* state is never colour alone — the status line says it too */}
              <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{it.name}</p>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">{it.detail}</p>
                <p className="mt-0.5 font-mono text-xs text-zinc-500 dark:text-zinc-400">
                  {it.status}
                </p>
              </div>
              {it.href && (
                <Button variant="outline" size="sm" asChild>
                  <Link href={it.href}>
                    Manage <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              )}
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
