'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import PageTitle from '../../ui/PageTitle'
import { monthLabel, platformLabel, previousMonth } from '../../../lib/client-report-core'
import { parseView, typesPresent, viewQuery, type V2View } from '../../../lib/report-v2/filters'
import type { V2Post, V2Report } from '../../../lib/report-v2/types'
import PlatformSection from './PlatformSection'
import PostsGrid, { PostDetail } from './PostsGrid'
import ChecksPanel, { ShareBox } from './ChecksPanel'

/**
 * REPORT V2 — THE PREVIEW (the owner, 5 Nov 2026: "rebuild the code for this page"; see it before it replaces Reports).
 * Client, month, account, type of post, who posted it and the sort live in the URL. Figures are read live, read only.
 */
const thisMonth = () => new Date().toISOString().slice(0, 7)
const select = 'h-9 rounded-md border border-border bg-background px-2 text-[14px]'

export default function ReportV2() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const view = useMemo(() => parseView(params), [params])
  const month = view.month ?? previousMonth(thisMonth())
  const [clients, setClients] = useState<{ id: string; name: string }[] | null>(null)
  const [report, setReport] = useState<V2Report | null>(null)
  const [blockers, setBlockers] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<V2Post | null>(null)
  const [nonce, setNonce] = useState(0)

  const setView = useCallback((patch: Partial<V2View>) => {
    const q = viewQuery({ ...view, month, ...patch })
    router.replace(`${pathname}${q ? `?${q}` : ''}`, { scroll: false })
  }, [view, month, router, pathname])

  useEffect(() => {
    fetch('/api/reports/preview').then(r => r.json()).then(j => setClients(j.clients ?? [])).catch(() => setClients([]))
  }, [])
  useEffect(() => {
    if (!view.client) { setReport(null); return }
    let live = true
    setLoading(true); setError(null)
    fetch(`/api/reports/preview?client_id=${encodeURIComponent(view.client)}&month=${month}`)
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? 'The figures could not be read'); return j })
      .then(j => { if (live) { setReport(j.report); setBlockers(j.blockers ?? []) } })
      .catch(e => { if (live) { setError(e.message); setReport(null) } })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [view.client, month, nonce])

  const platforms = report?.platforms ?? []
  const shownPlatforms = view.account === 'all' ? platforms : platforms.filter(p => p.platform === view.account)
  const allPosts = shownPlatforms.flatMap(p => p.posts)

  return (
    <div className="flex flex-col gap-6 pb-16">
      <PageTitle title="Report preview" summary="The rebuilt monthly report, read live from each account. Every number says where it came from, or why there is none. Nothing here is saved or shared." />
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[12px] text-muted-foreground">Client
          <select className={select} value={view.client ?? ''} onChange={e => setView({ client: e.target.value || null, account: 'all', type: 'all' })} aria-label="Client">
            <option value="">Pick a client…</option>
            {(clients ?? []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-muted-foreground">Month
          <input type="month" className={select} value={month} max={thisMonth()} onChange={e => e.target.value && setView({ month: e.target.value })} aria-label="Month" />
        </label>
        <span className="pb-2 text-[12px] text-muted-foreground">compared with {monthLabel(previousMonth(month))}</span>
        {view.client && <Button variant="outline" size="sm" onClick={() => setNonce(n => n + 1)} disabled={loading}><RefreshCw className={`mr-1 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Read again</Button>}
      </div>

      {!view.client && <p className="text-[14px] text-muted-foreground">Pick a client to read their {monthLabel(month)}.</p>}
      {loading && <div className="grid gap-3 sm:grid-cols-3"><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /></div>}
      {error && <p className="rounded-md border border-accent-red/40 bg-accent-red/10 p-3 text-[14px] text-accent-red">{error}</p>}

      {report && !loading && (
        <>
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Account">
            {[{ id: 'all', label: 'All accounts' }, ...platforms.map(p => ({ id: p.platform as string, label: platformLabel(p.platform) }))].map(t => (
              <button key={t.id} role="tab" aria-selected={view.account === t.id} onClick={() => setView({ account: t.id, type: 'all' })}
                className={`rounded-full border px-3 py-1 text-[13px] ${view.account === t.id ? 'border-foreground bg-foreground text-background' : 'border-border'}`}>{t.label}</button>
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <ChecksPanel checks={report.checks} />
            <ShareBox blockers={blockers} />
          </div>
          {report.gaps.map(g => <p key={g} className="text-[13px] text-accent-red">{g}</p>)}
          {shownPlatforms.map(p => <PlatformSection key={p.platform} p={p} month={month} />)}

          <section className="flex flex-col gap-3">
            <h2 className="text-[20px] font-semibold">Posts in {monthLabel(month)}</h2>
            <div className="flex flex-wrap gap-3">
              <label className="flex flex-col gap-1 text-[12px] text-muted-foreground">Type
                <select className={select} value={view.type} onChange={e => setView({ type: e.target.value as V2View['type'] })} aria-label="Type">
                  <option value="all">All types ({allPosts.length})</option>
                  {typesPresent(allPosts).map(t => <option key={t.type} value={t.type}>{t.type} ({t.count})</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[12px] text-muted-foreground">Posted by
                <select className={select} value={view.by} onChange={e => setView({ by: e.target.value as V2View['by'] })} aria-label="Posted by">
                  <option value="all">Anyone</option><option value="mdm">MD Media</option><option value="other">Not MD Media</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[12px] text-muted-foreground">Sort
                <select className={select} value={view.sort} onChange={e => setView({ sort: e.target.value as V2View['sort'] })} aria-label="Sort">
                  <option value="views">Most views</option><option value="reach">Most reach</option><option value="likes">Most likes</option><option value="date">Newest</option>
                </select>
              </label>
            </div>
            <PostsGrid posts={allPosts} view={view} onOpen={setOpen} />
          </section>
        </>
      )}
      <Dialog open={!!open} onOpenChange={o => { if (!o) setOpen(null) }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto bg-popover">
          <DialogHeader>
            <DialogTitle>{open ? `${platformLabel(open.platform)} ${open.kind}` : ''}</DialogTitle>
            <DialogDescription>{open?.publishedAt?.slice(0, 10) ?? ''}{open?.byMdm ? ' · posted by MD Media' : ''}</DialogDescription>
          </DialogHeader>
          {open && <PostDetail post={open} />}
        </DialogContent>
      </Dialog>
    </div>
  )
}
