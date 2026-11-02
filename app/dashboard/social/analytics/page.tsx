'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Search, TrendingUp } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import PlatformIcon from '../PlatformIcon'
import { LoadFailed } from '../../NotSetUp'
import EmptyState from '../../EmptyState'
import PageTitle from '../../ui/PageTitle'
import { emptyMetrics, engagement, type ChannelSummary, type Metrics } from '@/app/lib/social-analytics-core'
import type { ChannelRow } from '@/app/lib/social-analytics'
import { LoadingBlock, PeriodPicker, TotalsRow, n, usePeriod } from './shared'

type Overview = {
  clients: { id: string; name: string }[]
  channels: ChannelRow[]
  summaries: Record<string, ChannelSummary>
  complete: boolean
  readable: boolean
}

/**
 * ANALYTICS, BY CLIENT (the owner, 2 Nov 2026: "revamp it by client then branch it out through social medias").
 * Every client with connected channels, and how they did in the days picked; a client opens its channels,
 * a channel opens its posts, a post opens its numbers.
 */
export default function AnalyticsPage() {
  return <Suspense fallback={<LoadingBlock />}><Clients /></Suspense>
}

function Clients() {
  const { period, range, setPeriod, query } = usePeriod('this_week')
  const [data, setData] = useState<Overview | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [find, setFind] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true
    setData(null); setFailed(null)
    fetch(`/api/social/analytics/overview?from=${range.from}&to=${range.to}`)
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? 'Could not load analytics'); return j })
      .then(j => { if (live) setData(j) })
      .catch(e => {
        if (!live) return
        setFailed(e instanceof Error ? e.message : 'unknown')
        toast.error('We couldn’t load the numbers. Try again in a moment.')
      })
    return () => { live = false }
  }, [range.from, range.to, attempt])

  const rows = useMemo(() => {
    if (!data) return []
    return data.clients.map(c => {
      const channels = data.channels.filter(ch => ch.client_id === c.id)
      const totals: Metrics = emptyMetrics()
      let posts = 0
      for (const ch of channels) {
        const s = data.summaries[ch.provider_account_id]
        if (!s) continue
        posts += s.posts
        for (const k of Object.keys(totals) as (keyof Metrics)[]) totals[k] += s.totals[k]
      }
      return { ...c, channels, posts, totals }
    })
      .filter(r => r.channels.length > 0)
      .sort((a, b) => b.posts - a.posts || a.name.localeCompare(b.name))
  }, [data])

  const shown = rows.filter(r => !find.trim() || r.name.toLowerCase().includes(find.trim().toLowerCase()))
  const all = useMemo(() => {
    const totals = emptyMetrics()
    for (const r of rows) for (const k of Object.keys(totals) as (keyof Metrics)[]) totals[k] += r.totals[k]
    return { totals, posts: rows.reduce((s, r) => s + r.posts, 0) }
  }, [rows])

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Analytics"
        summary="Pick a client to see each of their social channels, then a channel to see its posts and how each one did."
        actions={<PeriodPicker period={period} range={range} onChange={setPeriod} />}
      />

      {failed && !data ? (
        <LoadFailed what="the numbers for these accounts" detail={failed} onRetry={() => setAttempt(a => a + 1)} />
      ) : !data ? <LoadingBlock /> : (
        <>
          <TotalsRow posts={all.posts} totals={all.totals} />
          {!data.readable && <p className="text-secondary-13 text-muted-foreground">Zernio did not answer, so the post numbers are missing. Try again in a moment.</p>}
          {data.readable && !data.complete && <p className="text-secondary-13 text-muted-foreground">Showing the first 3,000 posts of these days — pick fewer days to see them all.</p>}

          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={find} onChange={e => setFind(e.target.value)} placeholder="Find a client" className="pl-8" aria-label="Find a client" />
          </div>

          {rows.length === 0 ? (
            <EmptyState
              icon={TrendingUp}
              title="No channels connected yet"
              body="A client shows here once one of their Instagram, Facebook, LinkedIn or TikTok accounts is connected."
              actionLabel="Open Social channels"
              actionHref="/dashboard/social"
            />
          ) : shown.length === 0 ? (
            <p className="text-secondary-13 text-muted-foreground">No client called “{find.trim()}” has a connected channel.</p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {shown.map(r => (
                <li key={r.id}>
                  <Link href={`/dashboard/social/analytics/${r.id}?${query}`} className="block h-full">
                    <Card className="h-full transition-colors hover:border-foreground/25">
                      <CardContent className="flex h-full flex-col gap-3 p-4">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-card-title">{r.name}</p>
                          <span className="flex shrink-0 gap-1">
                            {[...new Set(r.channels.map(c => c.platform))].map(p => <PlatformIcon key={p} platform={p} size={20} />)}
                          </span>
                        </div>
                        <dl className="grid grid-cols-4 gap-2">
                          {([['Posts', r.posts], ['Views', Math.max(r.totals.views, r.totals.impressions)], ['Reach', r.totals.reach], ['Engaged', engagement(r.totals)]] as const).map(([k, v]) => (
                            <div key={k}>
                              <dt className="text-[12px] text-muted-foreground">{k}</dt>
                              <dd className="font-mono text-body-15 tabular-nums">{n(v)}</dd>
                            </div>
                          ))}
                        </dl>
                        <p className="mt-auto text-secondary-13 text-muted-foreground">
                          {r.channels.length} channel{r.channels.length === 1 ? '' : 's'}
                        </p>
                      </CardContent>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[12px] text-muted-foreground">From the platforms, through Zernio — posts made on the platforms directly count too. Figures can lag by up to 48 hours.</p>
        </>
      )}
    </div>
  )
}
