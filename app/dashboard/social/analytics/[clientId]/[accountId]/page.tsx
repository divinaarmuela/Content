'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { toast } from 'sonner'
import { Clock } from 'lucide-react'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import PlatformIcon, { brandFor } from '../../../PlatformIcon'
import { LoadFailed } from '../../../../NotSetUp'
import EmptyState from '../../../../EmptyState'
import PageTitle from '../../../../ui/PageTitle'
import { CAL_TZ } from '@/app/lib/gcal-core'
import {
  GROUP_WORDS, SORT_WORDS, engagement, groupPosts, sortPosts, sumMetrics,
  type AnalyticsPost, type GroupBy, type PostSort,
} from '@/app/lib/social-analytics-core'
import { Crumbs, LoadingBlock, PeriodPicker, PostRow, PostSheet, TotalsRow, n, usePeriod } from '../../shared'

type ChannelData = {
  channel: { id: string; platform: string; username: string | null; name: string | null; followers: number | null; growth: number | null }
  client: { id: string; name: string } | null
  posts: AnalyticsPost[]
  complete: boolean
  readable: boolean
}

/**
 * ONE CHANNEL'S POSTS (2 Nov 2026: "when click in it the posts are there … can categorize by weekly etc").
 * Every post it published in the days picked, grouped by week or month with each group's totals; a post opens its
 * own numbers.
 */
export default function ChannelAnalyticsPage() {
  return <Suspense fallback={<LoadingBlock />}><ChannelAnalytics /></Suspense>
}

function ChannelAnalytics() {
  const { clientId, accountId } = useParams<{ clientId: string; accountId: string }>()
  // the posts page opens on the last 90 days, so "by week" has weeks to show
  const { period, range, setPeriod, query } = usePeriod('last_90')
  const [data, setData] = useState<ChannelData | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [groupBy, setGroupBy] = useState<GroupBy>('week')
  const [sort, setSort] = useState<PostSort>('newest')
  const [open, setOpen] = useState<AnalyticsPost | null>(null)

  useEffect(() => {
    let live = true
    setData(null); setFailed(null)
    fetch(`/api/social/analytics/posts?account=${encodeURIComponent(accountId)}&from=${range.from}&to=${range.to}`)
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? 'Could not load the posts'); return j })
      .then(j => { if (live) setData(j) })
      .catch(e => {
        if (!live) return
        setFailed(e instanceof Error ? e.message : 'unknown')
        toast.error('We couldn’t load the posts. Try again in a moment.')
      })
    return () => { live = false }
  }, [accountId, range.from, range.to, attempt])

  const groups = useMemo(
    () => groupPosts(sortPosts(data?.posts ?? [], sort), groupBy, CAL_TZ),
    [data, sort, groupBy])
  const totals = useMemo(() => sumMetrics(data?.posts ?? []), [data])

  const label = data ? brandFor(data.channel.platform).label : 'Channel'
  const handle = data?.channel.username ? `@${data.channel.username}` : data?.channel.name ?? ''

  return (
    <div className="flex flex-col gap-4">
      <Crumbs items={[
        { label: 'Analytics', href: `/dashboard/social/analytics?${query}` },
        { label: data?.client?.name ?? 'Client', href: `/dashboard/social/analytics/${clientId}?${query}` },
        { label },
      ]} />
      <div className="flex items-center gap-3">
        {data && <PlatformIcon platform={data.channel.platform} size={36} />}
        <div className="min-w-0 flex-1">
          <PageTitle
            title={data ? `${label}${handle ? ` · ${handle}` : ''}` : 'Posts'}
            summary="Every post in these days. Click one to see how it did."
            actions={<PeriodPicker period={period} range={range} onChange={setPeriod} />}
          />
        </div>
      </div>

      {failed && !data ? (
        <LoadFailed what="this channel’s posts" detail={failed} onRetry={() => setAttempt(a => a + 1)} />
      ) : !data ? <LoadingBlock /> : (
        <>
          <TotalsRow followers={data.channel.followers} posts={data.posts.length} totals={totals} />
          {!data.readable && <p className="text-secondary-13 text-muted-foreground">Zernio did not answer, so the posts are missing. Try again in a moment.</p>}
          {data.readable && !data.complete && <p className="text-secondary-13 text-muted-foreground">Showing the first 3,000 posts — pick fewer days to see them all.</p>}

          <div className="flex flex-wrap items-center gap-2">
            <Select value={groupBy} onValueChange={v => setGroupBy(v as GroupBy)}>
              <SelectTrigger className="w-40" aria-label="Group the posts"><SelectValue /></SelectTrigger>
              <SelectContent>{GROUP_WORDS.map(g => <SelectItem key={g.key} value={g.key}>{g.label}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={sort} onValueChange={v => setSort(v as PostSort)}>
              <SelectTrigger className="w-44" aria-label="Order the posts"><SelectValue /></SelectTrigger>
              <SelectContent>{SORT_WORDS.map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          {data.posts.length === 0 ? (
            <EmptyState icon={Clock} title="No posts in these days"
              body="Pick more days above. Posts show here the day after they go live, including ones posted on the platform directly." />
          ) : (
            <div className="flex flex-col gap-5">
              {groups.map(g => (
                <section key={g.key} className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border pb-1.5">
                    <h2 className="text-card-title">{g.label}</h2>
                    <p className="font-mono text-secondary-13 tabular-nums text-muted-foreground">
                      {g.posts.length} post{g.posts.length === 1 ? '' : 's'} · {n(Math.max(g.totals.views, g.totals.impressions))} views · {n(g.totals.reach)} reach · {n(engagement(g.totals))} engaged
                    </p>
                  </div>
                  <ul className="flex flex-col gap-2">
                    {g.posts.map(p => <li key={p.id}><PostRow post={p} onOpen={setOpen} /></li>)}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </>
      )}
      <PostSheet post={open} onClose={() => setOpen(null)} />
    </div>
  )
}
