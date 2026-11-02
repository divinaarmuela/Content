'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { toast } from 'sonner'
import { TrendingUp } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import PlatformIcon, { brandFor } from '../../PlatformIcon'
import { LoadFailed } from '../../../NotSetUp'
import EmptyState from '../../../EmptyState'
import PageTitle from '../../../ui/PageTitle'
import { emptyMetrics, engagement, type AnalyticsPost, type ChannelSummary, type Metrics } from '@/app/lib/social-analytics-core'
import type { ChannelRow } from '@/app/lib/social-analytics'
import { Crumbs, FreshnessCard, LoadingBlock, PeriodPicker, PostSheet, Thumb, TotalsRow, followerWords, n, newest, postedOn, usePeriod } from '../shared'

type ClientData = {
  clients: { id: string; name: string }[]
  channels: ChannelRow[]
  summaries: Record<string, ChannelSummary>
  top: AnalyticsPost[]
  complete: boolean
  readable: boolean
  asOf: string | null
  syncing: boolean
}

/** ONE CLIENT'S ANALYTICS (2 Nov 2026): their channels, each with its numbers for the days picked, and their best posts. */
export default function ClientAnalyticsPage() {
  return <Suspense fallback={<LoadingBlock />}><ClientAnalytics /></Suspense>
}

function ClientAnalytics() {
  const { clientId } = useParams<{ clientId: string }>()
  const { period, range, setPeriod, setCustom, query } = usePeriod('this_week')
  const [data, setData] = useState<ClientData | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [open, setOpen] = useState<AnalyticsPost | null>(null)

  useEffect(() => {
    let live = true
    setData(null); setFailed(null)
    fetch(`/api/social/analytics/overview?clientId=${encodeURIComponent(clientId)}&from=${range.from}&to=${range.to}`)
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? 'Could not load analytics'); return j })
      .then(j => { if (live) setData(j) })
      .catch(e => {
        if (!live) return
        setFailed(e instanceof Error ? e.message : 'unknown')
        toast.error('We couldn’t load the numbers. Try again in a moment.')
      })
    return () => { live = false }
  }, [clientId, range.from, range.to, attempt])

  const name = data?.clients[0]?.name ?? 'Client'
  const all = useMemo(() => {
    const totals: Metrics = emptyMetrics()
    let posts = 0
    for (const s of Object.values(data?.summaries ?? {})) {
      posts += s.posts
      for (const k of Object.keys(totals) as (keyof Metrics)[]) totals[k] += s.totals[k]
    }
    return { totals, posts, followers: (data?.channels ?? []).reduce((s, c) => s + (c.followers ?? 0), 0) }
  }, [data])
  // by network, so a client's Facebook is always in the same place
  const channels = useMemo(() => [...(data?.channels ?? [])].sort((a, b) =>
    brandFor(a.platform).label.localeCompare(brandFor(b.platform).label)), [data])

  return (
    <div className="flex flex-col gap-4">
      <Crumbs items={[{ label: 'Analytics', href: `/dashboard/social/analytics?${query}` }, { label: name }]} />
      <PageTitle
        title={name}
        summary="Each social channel and how it did. Open one to see its posts."
        actions={<PeriodPicker period={period} range={range} onChange={setPeriod} onCustom={setCustom} />}
      />

      {failed && !data ? (
        <LoadFailed what="this client’s numbers" detail={failed} onRetry={() => setAttempt(a => a + 1)} />
      ) : !data ? <LoadingBlock /> : (
        <>
          <FreshnessCard range={range} asOf={data.asOf} syncing={data.syncing} followersReadAt={newest(data.channels.map(c => c.followersReadAt))} />
          <TotalsRow followers={all.followers} posts={all.posts} totals={all.totals} />
          {!data.readable && <p className="text-secondary-13 text-muted-foreground">The platforms did not answer, so the post numbers are missing. Try again in a moment.</p>}

          <section className="flex flex-col gap-2">
            <h2 className="text-card-title">Channels</h2>
            {channels.length === 0 ? (
              <EmptyState icon={TrendingUp} title="No channels connected"
                body="Connect this client’s Instagram, Facebook, LinkedIn or TikTok and the numbers appear here within a day."
                actionLabel="Open Social channels" actionHref="/dashboard/social" />
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {channels.map(ch => {
                  const s = data.summaries[ch.provider_account_id]
                  const t = s?.totals ?? emptyMetrics()
                  return (
                    <li key={ch.id}>
                      <Link href={`/dashboard/social/analytics/${clientId}/${ch.id}?${query}`} className="block h-full">
                        <Card className="h-full transition-colors hover:border-foreground/25">
                          <CardContent className="flex flex-col gap-3 p-4">
                            <div className="flex items-center gap-3">
                              <PlatformIcon platform={ch.platform} size={32} />
                              <div className="min-w-0">
                                <p className="truncate text-body-15 font-medium">{brandFor(ch.platform).label}</p>
                                <p className="truncate text-secondary-13 text-muted-foreground">
                                  {ch.username ? `@${ch.username}` : ch.name ?? ''}
                                </p>
                              </div>
                              <div className="ml-auto text-right">
                                <p className="font-mono text-body-15 tabular-nums">{n(ch.followers)}</p>
                                <p className="text-[12px] text-muted-foreground">followers today</p>
                                {followerWords(ch.growth, ch.growthSince) && (
                                  <p className="text-[12px] text-muted-foreground">{followerWords(ch.growth, ch.growthSince)}</p>
                                )}
                              </div>
                            </div>
                            <dl className="grid grid-cols-4 gap-2 border-t border-border pt-3">
                              {([['Posts', s?.posts ?? 0], ['Views', Math.max(t.views, t.impressions)], ['Reach', t.reach], ['Engaged', engagement(t)]] as const).map(([k, v]) => (
                                <div key={k}>
                                  <dt className="text-[12px] text-muted-foreground">{k}</dt>
                                  <dd className="font-mono text-body-15 tabular-nums">{n(v)}</dd>
                                </div>
                              ))}
                            </dl>
                          </CardContent>
                        </Card>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          {data.top.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-card-title">Best posts <span className="font-normal text-muted-foreground">by views</span></h2>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
                {data.top.map(p => (
                  <li key={p.id}>
                    <button type="button" onClick={() => setOpen(p)}
                      className="flex w-full flex-col gap-1.5 rounded-inner border border-border p-2 text-left transition-colors hover:border-foreground/25">
                      <div className="relative">
                        <Thumb src={p.thumbnail} platform={p.platform} className="aspect-square w-full rounded-md" />
                        {p.platform && <span className="absolute left-1.5 top-1.5"><PlatformIcon platform={p.platform} size={18} /></span>}
                      </div>
                      <p className="line-clamp-2 text-secondary-13">{p.content || '(no caption)'}</p>
                      <p className="font-mono text-secondary-13 tabular-nums">{n(Math.max(p.metrics.views, p.metrics.impressions))} views</p>
                      <p className="text-[12px] text-muted-foreground">{postedOn(p.publishedAt)}</p>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      <PostSheet post={open} onClose={() => setOpen(null)} />
    </div>
  )
}
