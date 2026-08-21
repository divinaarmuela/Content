'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, usePathname } from 'next/navigation'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  ArrowLeft, ClipboardList, Copy, KeyRound, MessageSquare, Palette, FileText, Share2, Users } from 'lucide-react'
import { publicUrl } from '@/app/lib/public-url'
import { useRole } from '../../useRole'
import { canSeeSubpage } from '@/app/lib/page-access-core'

/**
 * One client, one shell. The tabs are real CHILD ROUTES rather than state:
 * a refresh keeps you on Brand, the URL can be sent to whoever is doing the
 * work, and the back button means something.
 */

type Client = {
  id: string
  name: string
  slug: string
  industry: string
  status: string
  share_token: string | null
}

const STATUS: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900',
  paused: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900',
  archived: 'bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700',
}

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ id: string }>()
  const clientId = params.id
  const path = usePathname()
  const { role } = useRole()
  // which client tabs this person may open is configured in Settings rather
  // than hardcoded — an editor might need Brand but never Credentials
  const [granted, setGranted] = useState<string[]>([])
  useEffect(() => {
    fetch('/api/team/page-access')
      .then(r => r.ok ? r.json() : { mine: [] })
      .then(j => setGranted(j.mine ?? []))
      .catch(() => {})
  }, [])

  const [client, setClient] = useState<Client | null>(null)
  const [missing, setMissing] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/website/clients/${clientId}`)
      const json = await res.json()
      if (res.status === 404) { setMissing(true); return }
      if (!res.ok) throw new Error(json.error ?? 'Could not load client')
      setClient(json)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load client')
    }
  }, [clientId])

  useEffect(() => { load() }, [load])

  if (missing) {
    return (
      <Card className="border-dashed shadow-none">
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">That client no longer exists.</p>
          <Button variant="outline" size="sm" asChild>
            <Link href="/dashboard/clients">Back to clients</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  const base = `/dashboard/clients/${clientId}`
  const ALL_TABS = [
    { key: null, href: base, label: 'Overview', icon: Users, exact: true },
    { key: '/dashboard/clients/:id/contacts', href: `${base}/contacts`, label: 'Contacts', icon: Users },
    { key: '/dashboard/clients/:id/notes', href: `${base}/notes`, label: 'Notes', icon: MessageSquare },
    { key: '/dashboard/clients/:id/credentials', href: `${base}/credentials`, label: 'Credentials', icon: KeyRound },
    { key: '/dashboard/clients/:id/social', href: `${base}/social`, label: 'Social', icon: Share2 },
    { key: '/dashboard/clients/:id/intake', href: `${base}/intake`, label: 'Intake', icon: ClipboardList },
    { key: '/dashboard/clients/:id/brand', href: `${base}/brand`, label: 'Brand', icon: Palette },
    { key: '/dashboard/clients/:id/agreement', href: `${base}/agreement`, label: 'Agreement', icon: FileText },
  ]
  const TABS = ALL_TABS.filter(t => t.key === null || canSeeSubpage(role, t.key, granted))

  const portalUrl = client?.share_token ? publicUrl(`/portal/${client.share_token}`) : null

  return (
    <div className="flex flex-col gap-5">
      {/* ── header ── */}
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-2">
          <Link href="/dashboard/clients">
            <ArrowLeft className="h-4 w-4" /> All clients
          </Link>
        </Button>

        {client ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-b from-zinc-800 to-zinc-950 font-mono text-sm text-white">
              {client.name.slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold tracking-tight">{client.name}</h2>
              <p className="font-mono text-xs text-zinc-400">
                {client.industry || 'No industry set'} · /{client.slug}
              </p>
            </div>

            <Badge variant="outline" className={`${STATUS[client.status] ?? STATUS.archived} capitalize`}>
              {client.status}
            </Badge>

            {portalUrl && (
              <Button variant="outline" size="sm" className="ml-auto"
                onClick={() => { navigator.clipboard.writeText(portalUrl); toast.success('Portal link copied') }}>
                <Copy className="h-3.5 w-3.5" /> Portal link
              </Button>
            )}
          </div>
        ) : (
          <Skeleton className="h-11 w-72" />
        )}
      </div>

      {/* ── tabs, as links ── */}
      <nav className="inline-flex h-9 w-fit max-w-full items-center justify-start overflow-x-auto rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800">
        {TABS.map(t => {
          const Icon = t.icon
          const active = t.exact ? path === t.href : path.startsWith(t.href)
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-all ${
                active
                  ? 'bg-white text-zinc-950 shadow-sm dark:bg-zinc-950 dark:text-zinc-50'
                  : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
              }`}
            >
              <Icon className="h-3.5 w-3.5" /> {t.label}
            </Link>
          )
        })}
      </nav>

      {children}
    </div>
  )
}
