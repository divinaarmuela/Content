'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { ExternalLink, CheckCircle2, MessageSquare } from 'lucide-react'
import { CommitmentCards, PortalSection } from '../components/portal/PortalSections'
import { publishedLines } from '../lib/post-analytics-core'
import ShootSection from '../components/portal/ShootSection'
import { APPROVED_TOAST, approveConsequence, changesSentToast, contentTypeLabel } from '../lib/portal-words'
import type { PortalData, PortalItem } from '../lib/portal-data'

function Media({ src, className }: { src: string; className?: string }) {
  if (/\.(mp4|webm|mov)(\?|$)/i.test(src)) {
    return <video src={src} controls playsInline className={className} />
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" className={className} />
}

export default function ClientPortalPage() {
  const [data, setData] = useState<(PortalData & { viewer_role: string }) | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [changing, setChanging] = useState<PortalItem | null>(null)
  const [changeText, setChangeText] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/portal')
    if (!res.ok) {
      setError((await res.json()).error ?? 'Could not load your workspace')
      return
    }
    setData(await res.json())
  }, [])

  useEffect(() => { load() }, [load])

  const approve = async (item: PortalItem) => {
    setBusy(item.id)
    try {
      const res = await fetch(`/api/production/items/${item.id}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: 'approved_for_scheduling' }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Approval failed')
      toast.success(APPROVED_TOAST)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Approval failed')
    } finally {
      setBusy(null)
    }
  }

  const requestChanges = async () => {
    if (!changing || !changeText.trim()) return
    setBusy(changing.id)
    try {
      // comment first so the AM gets the context, then the status change
      const c = await fetch(`/api/production/items/${changing.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: changeText.trim() }),
      })
      if (!c.ok) throw new Error((await c.json()).error ?? 'Could not send your feedback')
      const t = await fetch(`/api/production/items/${changing.id}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: 'client_changes_requested' }),
      })
      if (!t.ok) throw new Error((await t.json()).error ?? 'Could not submit the request')
      toast.success(changesSentToast(data?.am_name))
      setChanging(null)
      setChangeText('')
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setBusy(null)
    }
  }

  if (error) {
    return (
      <Card className="border-dashed shadow-none">
        <CardContent className="py-14 text-center text-sm text-zinc-500">{error}</CardContent>
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

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">{data.client.name}</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Everything we&apos;re making for you, in one place — no chasing required.
        </p>
      </div>

      <CommitmentCards data={data} />

      {/* Needs review — the interactive heart of the portal */}
      <Card className={data.needs_review.length > 0 ? 'border-violet-200 dark:border-violet-900' : ''}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            Needs your review
            {data.needs_review.length > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-violet-600 px-1.5 font-mono text-[10px] text-white">
                {data.needs_review.length}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 pt-0">
          {data.needs_review.length === 0 && (
            <p className="text-sm text-zinc-400 dark:text-zinc-500">Nothing waiting on you right now.</p>
          )}
          {data.needs_review.map(item => (
            <div key={item.id} className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
              {item.preview_url && <Media src={item.preview_url} className="max-h-96 w-full bg-zinc-950 object-contain" />}
              <p className="px-3 pt-3 text-xs text-zinc-500 dark:text-zinc-400">{approveConsequence(data.am_name)}</p>
              {/* on a phone the title and three `size="sm"` buttons fought over
                  one 320px row; the buttons get their own full-width row and a
                  44px hit area, and only line up beside the title from sm up */}
              <div className="flex flex-col gap-3 p-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{item.title}</p>
                  {contentTypeLabel(item.content_type) && (
                    <p className="font-mono text-[10px] uppercase text-zinc-400 dark:text-zinc-500">{contentTypeLabel(item.content_type)}</p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {item.drive_url && (
                    <Button variant="outline" size="sm" className="h-11 flex-1 sm:h-8 sm:flex-none" asChild>
                      <a href={item.drive_url} target="_blank" rel="noreferrer noopener">
                        Open the file <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                  )}
                  <Button variant="outline" size="sm" className="h-11 flex-1 sm:h-8 sm:flex-none" disabled={busy === item.id}
                    onClick={() => { setChanging(item); setChangeText('') }}>
                    <MessageSquare className="h-3.5 w-3.5" /> Request changes
                  </Button>
                  <Button size="sm" className="h-11 flex-1 sm:h-8 sm:flex-none" disabled={busy === item.id} onClick={() => approve(item)}>
                    <CheckCircle2 className="h-3.5 w-3.5" /> {busy === item.id ? 'Working…' : 'Approve'}
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* the shoot plans the team shared — the "your plan is ready" email
          lands on THIS page, so the plan and its two moves have to be here */}
      {/* the portal components are themed by --p-* variables; inside the
          dashboard shell they take the dashboard's own tokens so the section
          follows light/dark with everything else */}
      <div style={{
        ['--p-bg' as string]: 'hsl(var(--background))',
        ['--p-ink' as string]: 'hsl(var(--foreground))',
        ['--p-surface' as string]: 'hsl(var(--card))',
        ['--p-border' as string]: 'hsl(var(--border))',
        ['--p-accent' as string]: 'hsl(var(--primary))',
        ['--p-accent-ink' as string]: 'hsl(var(--primary-foreground))',
      }}>
        <ShootSection shoots={data.shoots} clientName={data.client.name} amName={data.am_name}
          loggedIn onActed={load} />
      </div>

      {data.changes_requested.length > 0 && (
        <PortalSection title="Your changes are being made" items={data.changes_requested} empty="" />
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <PortalSection title="In production" items={data.in_production} empty="Nothing in production right now." />
        <PortalSection title="Approved & scheduled" items={[...data.approved, ...data.scheduled]} empty="Nothing approved yet." />
      </div>
      {/* the portal cards are themed by --p-* variables; inside the dashboard
          shell they take the dashboard's own tokens */}
      <PortalSection title="Published" items={data.published}
        lines={publishedLines(data)}
        empty="Published posts will appear here with live links." />
    </div>
  )
}
