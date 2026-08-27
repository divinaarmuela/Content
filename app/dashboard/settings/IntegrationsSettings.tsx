'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ArrowRight, Copy } from 'lucide-react'

type Integration = {
  key: string
  name: string
  detail: string
  connected: boolean
  configured: boolean
  status: string
  href: string | null
  /** present only where connecting is a thing the viewer may do */
  connect_href?: string | null
  disconnect_href?: string | null
  /** a POST the viewer may run against this integration, and its button text */
  action_href?: string | null
  action_label?: string | null
  /** a value worth copying — a webhook URL to paste into the provider */
  copy_value?: string | null
  copy_label?: string | null
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
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(() => {
    fetch('/api/team/integrations')
      .then(async r => {
        const j = await r.json()
        if (!r.ok) throw new Error(j.error ?? 'Could not load integrations')
        return j
      })
      .then(setItems)
      .catch(e => { toast.error(e.message); setItems([]) })
  }, [])

  useEffect(() => { load() }, [load])

  // The OAuth round trip comes back here with its result in the query string —
  // an OAuth callback has no way to tell the page anything else. Read from the
  // URL directly rather than useSearchParams: this is a one-shot read on
  // mount, and it keeps the page out of the Suspense boundary that hook demands.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const result = params.get('gdrive')
    if (!result) return
    const detail = params.get('detail')
    if (result === 'ok') toast.success(detail ? `Google Drive connected as ${detail}` : 'Google Drive connected')
    else toast.error(detail || 'Google Drive could not be connected')
    window.history.replaceState(null, '', window.location.pathname)
  }, [])

  /**
   * The per-integration action button — "Re-share with team", "Enable instant
   * post updates".
   *
   * Each reports what it CHANGED rather than "done": the whole reason to press
   * Re-share is that you suspect the automatic reconciles missed someone, and
   * "no changes needed" is a genuinely different answer from "shared with 2".
   * A route that already says it in words (`message`) is quoted as-is.
   */
  async function runAction(href: string) {
    setBusy(href)
    try {
      const res = await fetch(href, { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'That did not work')
      if (typeof json.message === 'string') {
        toast.success(json.message)
      } else {
        const added = Array.isArray(json.added) ? json.added.length : 0
        const removed = Array.isArray(json.removed) ? json.removed.length : 0
        toast.success(
          added || removed
            ? `Shared with ${added}, access removed for ${removed}`
            : 'Everyone who should have access already does',
        )
      }
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'That did not work')
    } finally {
      setBusy(null)
    }
  }

  /** Copy a value the provider's own dashboard needs pasting into it. */
  async function copyValue(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(`${label} copied`)
    } catch {
      // clipboard access can be refused outright; showing the value is the
      // fallback that still lets somebody select it by hand — but a red
      // toast that is only the value reads as an error about the value
      toast.error(`Couldn’t copy the ${label.toLowerCase()}`, {
        description: `Select it and copy it by hand: ${value}`, duration: 15_000,
      })
    }
  }

  async function disconnect(href: string) {
    setBusy(href)
    try {
      const res = await fetch(href, { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Could not disconnect')
      toast.success('Disconnected. Folders already created are left alone.')
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not disconnect')
    } finally {
      setBusy(null)
    }
  }

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
              {/* full navigation, not fetch: the connect route replies with a
                  redirect to the provider's own consent screen */}
              {it.connect_href && (
                <Button size="sm" asChild>
                  <a href={it.connect_href}>Connect</a>
                </Button>
              )}
              {it.copy_value && (
                <Button
                  variant="ghost" size="sm"
                  onClick={() => void copyValue(it.copy_value!, it.copy_label ?? 'Value')}
                >
                  <Copy className="h-3.5 w-3.5" /> {it.copy_label ?? 'Copy'}
                </Button>
              )}
              {it.action_href && (
                <Button
                  variant="outline" size="sm"
                  disabled={busy === it.action_href}
                  onClick={() => void runAction(it.action_href!)}
                >
                  {busy === it.action_href ? 'Working…' : it.action_label ?? 'Run'}
                </Button>
              )}
              {it.disconnect_href && (
                <Button
                  variant="outline" size="sm"
                  disabled={busy === it.disconnect_href}
                  onClick={() => void disconnect(it.disconnect_href!)}
                >
                  {busy === it.disconnect_href ? 'Disconnecting…' : 'Disconnect'}
                </Button>
              )}
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
