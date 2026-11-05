'use client'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

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
 * REPORT V2 (the owner, 5 Nov 2026: "rebuild the code for this page"; then "replace the current reports page with the
 * new one"). Client, month, account, type of post, who posted it and the sort live in the URL. Figures are read live,
 * read only. `ReportV2Body` is what the Reports page shows; the default export is the stand-alone view.
 */
const thisMonth = () => new Date().toISOString().slice(0, 7)

export default function ReportV2() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const view = useMemo(() => parseView(params), [params])
  const month = view.month ?? previousMonth(thisMonth())
  const [clients, setClients] = useState<{ id: string; name: string }[] | null>(null)
  const setView = useCallback((patch: Partial<V2View>) => {
    const q = viewQuery({ ...view, month, ...patch })
    router.replace(`${pathname}${q ? `?${q}` : ''}`, { scroll: false })
  }, [view, month, router, pathname])
  useEffect(() => {
    fetch('/api/reports/preview').then(r => r.json()).then(j => setClients(j.clients ?? [])).catch(() => setClients([]))
  }, [])
  return (
    <div className="flex flex-col gap-6 pb-16">
      <PageTitle title="Report" summary="The monthly report, read live from each account. Every number says where it came from, or why there is none." />
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[12px] text-muted-foreground">Client
          <Pick label="Client" value={view.client ?? ''} placeholder="Pick a client…" onChange={v => setView({ client: v || null, account: 'all', type: 'all' })}
            options={(clients ?? []).map(c => ({ value: c.id, label: c.name }))} wide />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-muted-foreground">Month
          <Pick label="Month" value={month} onChange={v => setView({ month: v })}
            options={Array.from({ length: 18 }, (_, i) => { const d = new Date(`${thisMonth()}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - i); const k = d.toISOString().slice(0, 7); return { value: k, label: monthLabel(k as never) } })} />
        </label>
      </div>
      {!view.client && <p className="text-[14px] text-muted-foreground">Pick a client to read their {monthLabel(month)}.</p>}
      {view.client && <ReportV2Body clientId={view.client} month={month} showShareBox />}
    </div>
  )
}

/**
 * THE FIGURES, POSTS AND CHECKS for one client and month. Account, type, who posted it and the sort live in the URL
 * beside client and month. Read live and read only. `onChecks` hands the share blockers up, so the page's Share can
 * say why it is blocked.
 */
export function ReportV2Body({ clientId, month, showShareBox = false, onChecks }: {
  clientId: string; month: string; showShareBox?: boolean; onChecks?: (blockers: string[]) => void
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const view = useMemo(() => parseView(params), [params])
  const [report, setReport] = useState<V2Report | null>(null)
  const [blockers, setBlockers] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<V2Post | null>(null)
  const [nonce, setNonce] = useState(0)

  const setView = useCallback((patch: Partial<V2View>) => {
    const q = viewQuery({ ...view, client: clientId, month, ...patch })
    router.replace(`${pathname}${q ? `?${q}` : ''}`, { scroll: false })
  }, [view, clientId, month, router, pathname])

  useEffect(() => {
    let live = true
    setLoading(true); setError(null)
    fetch(`/api/reports/preview?client_id=${encodeURIComponent(clientId)}&month=${month}`)
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? 'The figures could not be read'); return j })
      .then(j => { if (live) { setReport(j.report); setBlockers(j.blockers ?? []); onChecks?.(j.blockers ?? []) } })
      .catch(e => { if (live) { setError(e.message); setReport(null) } })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, month, nonce])

  const platforms = report?.platforms ?? []
  const shownPlatforms = view.account === 'all' ? platforms : platforms.filter(p => p.platform === view.account)
  const allPosts = shownPlatforms.flatMap(p => p.posts)

  return (
    <div className="flex flex-col gap-6">
      <div className="no-print flex flex-wrap items-center gap-3">
        <span className="text-[13px] text-muted-foreground">
          {monthLabel(month)}, compared with {monthLabel(previousMonth(month))}
          {report ? ` · read ${new Date(report.readAt).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` : ''}
        </span>
        <Button variant="outline" size="sm" onClick={() => setNonce(n => n + 1)} disabled={loading} className="rounded-full">
          <RefreshCw className={`mr-1 h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden />Read the figures again
        </Button>
      </div>
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
          <div className={`grid gap-4 ${showShareBox ? 'lg:grid-cols-2' : ''}`}>
            <ChecksPanel checks={report.checks} />
            {showShareBox && <ShareBox blockers={blockers} />}
          </div>
          {report.gaps.map(g => <p key={g} className="text-[13px] text-accent-red">{g}</p>)}
          {shownPlatforms.map(p => <PlatformSection key={p.platform} p={p} month={month} />)}

          <section className="flex flex-col gap-3">
            <h2 className="text-[20px] font-semibold">Posts in {monthLabel(month)}</h2>
            <div className="flex flex-wrap gap-3">
              <label className="flex flex-col gap-1 text-[12px] text-muted-foreground">Type
                <Pick label="Type" value={view.type} onChange={v => setView({ type: v as V2View['type'] })}
                  options={[{ value: 'all', label: `All types (${allPosts.length})` }, ...typesPresent(allPosts).map(t => ({ value: t.type, label: `${t.type[0].toUpperCase()}${t.type.slice(1)}s (${t.count})` }))]} />
              </label>
              <label className="flex flex-col gap-1 text-[12px] text-muted-foreground">Posted by
                <Pick label="Posted by" value={view.by} onChange={v => setView({ by: v as V2View['by'] })}
                  options={[{ value: 'all', label: 'Anyone' }, { value: 'mdm', label: 'MD Media' }, { value: 'other', label: 'Not MD Media' }]} />
              </label>
              <label className="flex flex-col gap-1 text-[12px] text-muted-foreground">Sort
                <Pick label="Sort" value={view.sort} onChange={v => setView({ sort: v as V2View['sort'] })}
                  options={[{ value: 'views', label: 'Most views' }, { value: 'reach', label: 'Most reach' }, { value: 'likes', label: 'Most likes' }, { value: 'date', label: 'Newest' }]} />
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

/** the app's own dropdown (shadcn Select), not the browser's plain one (the owner, 5 Nov 2026: "why is the dropdown so ugly") */
function Pick({ label, value, options, onChange, placeholder, wide = false }: {
  label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; placeholder?: string; wide?: boolean
}) {
  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className={`h-10 ${wide ? 'w-64' : 'w-44'} rounded-full border-border bg-surface px-4 text-[14px] font-medium`}>
        <SelectValue placeholder={placeholder ?? label} />
      </SelectTrigger>
      <SelectContent className="bg-popover">
        {options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}
