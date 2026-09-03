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
  ArrowLeft, CalendarDays, ChevronRight, ClipboardList, Copy, KeyRound, MessageSquare, Palette, FileText, Share2, Users } from 'lucide-react'
import { publicUrl } from '@/app/lib/public-url'
import { useRole } from '../../useRole'
import { canSeeSubpage } from '@/app/lib/page-access-core'
import PageTitle from '../../ui/PageTitle'

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
  active: 'bg-tint-green text-foreground border-accent-green/30',
  paused: 'bg-tint-amber text-foreground border-accent-amber/35',
  archived: 'bg-foreground/[0.06] text-muted-foreground border-border',
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
          <p className="text-body-15 text-muted-foreground">That client no longer exists.</p>
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
    // order is reach: at 390px about three and a half tabs are visible, and
    // Agreement and Brand — the two an account manager opens most — used to be
    // the two off the end of a bar with no cue that it scrolled
    { key: '/dashboard/clients/:id/agreement', href: `${base}/agreement`, label: 'Agreement', icon: FileText },
    { key: '/dashboard/clients/:id/brand', href: `${base}/brand`, label: 'Brand', icon: Palette },
    { key: '/dashboard/clients/:id/contacts', href: `${base}/contacts`, label: 'Contacts', icon: Users },
    { key: '/dashboard/clients/:id/notes', href: `${base}/notes`, label: 'Notes', icon: MessageSquare },
    { key: '/dashboard/clients/:id/social', href: `${base}/social`, label: 'Social', icon: Share2 },
    { key: '/dashboard/clients/:id/intake', href: `${base}/intake`, label: 'Intake', icon: ClipboardList },
    { key: '/dashboard/clients/:id/monthly', href: `${base}/monthly`, label: 'Monthly', icon: CalendarDays },
    { key: '/dashboard/clients/:id/credentials', href: `${base}/credentials`, label: 'Credentials', icon: KeyRound },
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
          <PageTitle
            title={client.name}
            summary={`${client.industry || 'No industry set'} · /${client.slug}`}
            actions={<>
              <Badge variant="outline" className={`${STATUS[client.status] ?? STATUS.archived} capitalize`}>
                {client.status}
              </Badge>
              {portalUrl && (
                <Button variant="outline" size="sm"
                  onClick={() => { navigator.clipboard.writeText(portalUrl); toast.success('Portal link copied') }}>
                  <Copy className="h-3.5 w-3.5" /> Portal link
                </Button>
              )}
            </>}
          />
        ) : (
          <Skeleton className="h-11 w-72" />
        )}
      </div>

      {/* ── tabs, as links ── */}
      {/* the fade is the only thing that says "there is more this way" — the
          bar scrolled silently before, so half the tabs did not exist */}
      <div className="relative max-w-full">
      <nav className="inline-flex w-fit max-w-full items-center justify-start overflow-x-auto rounded-inner bg-foreground/[0.06] p-1">
        {TABS.map(t => {
          const Icon = t.icon
          const active = t.exact ? path === t.href : path.startsWith(t.href)
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-tile px-3 py-2.5 text-body-15 font-medium transition-all ${
                active
                  ? 'bg-surface text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="h-3.5 w-3.5" /> {t.label}
            </Link>
          )
        })}
      </nav>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 flex w-10 items-center justify-end rounded-r-lg bg-gradient-to-l from-background to-transparent pr-1 text-muted-foreground"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </span>
      </div>

      {children}
    </div>
  )
}
