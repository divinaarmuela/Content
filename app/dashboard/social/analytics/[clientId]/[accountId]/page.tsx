'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { toast } from 'sonner'
import { Clock } from 'lucide-react'
import PlatformIcon, { brandFor } from '../../../PlatformIcon'
import { LoadFailed } from '../../../../NotSetUp'
import EmptyState from '../../../../EmptyState'
import PageTitle from '../../../../ui/PageTitle'
import { CAL_TZ } from '@/app/lib/gcal-core'
import {
  SORT_WORDS, engagement, groupFor, groupPosts, sortPosts, sumMetrics,
  type AnalyticsPost, type PostSort,
} from '@/app/lib/social-analytics-core'
import { Crumbs, FreshnessCard, LoadingBlock, PeriodPicker, PostRow, PostSheet, TotalsRow, followerWords, n, usePeriod } from '../../shared'

type ChannelData = {
  channel: { id: string; platform: string; username: string | null; name: string | null; followers: number | null; growth: number | null; growthSince: string | null; followersReadAt: string | null }
  client: { id: string; name: string } | null
  posts: AnalyticsPost[]
  complete: boolean
  readable: boolean
  asOf: string | null
  syncing: boolean
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
  const { period, range, setPeriod, setCustom, query } = usePeriod('last_90')
  const [data, setData] = useState<ChannelData | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
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

  // ONE FILTER (the owner, 2 Nov 2026: "why are there two filters here, can be confusing"): the days picked decide
  // the grouping — a week is one list, a month or 90 days goes by week, twelve months by month
  const groups = useMemo(
    () => groupPosts(sortPosts(data?.posts ?? [], sort), groupFor(range), CAL_TZ),
    [data, sort, range])
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
            actions={<PeriodPicker period={period} range={range} onChange={setPeriod} onCustom={setCustom} />}
          />
        </div>
      </div>

      {failed && !data ? (
        <LoadFailed what="this channel’s posts" detail={failed} onRetry={() => setAttempt(a => a + 1)} />
      ) : !data ? <LoadingBlock /> : (
        <>
          <FreshnessCard range={range} asOf={data.asOf} syncing={data.syncing} followersReadAt={data.channel.followersReadAt} />
          <TotalsRow followers={data.channel.followers} followerNote={followerWords(data.channel.growth, data.channel.growthSince)} posts={data.posts.length} totals={totals} />
          {!data.readable && <p className="text-secondary-13 text-muted-foreground">The platforms did not answer, so the posts are missing. Try again in a moment.</p>}
          {data.readable && !data.complete && <p className="text-secondary-13 text-muted-foreground">Showing the first 3,000 posts — pick fewer days to see them all.</p>}

          {data.posts.length > 1 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-secondary-13" role="group" aria-label="Order the posts">
              <span className="text-muted-foreground">Order:</span>
              {SORT_WORDS.map(o => (
                <button key={o.key} type="button" onClick={() => setSort(o.key)} aria-pressed={sort === o.key}
                  className={sort === o.key ? 'font-medium text-foreground underline underline-offset-4' : 'text-muted-foreground hover:text-foreground'}>
                  {o.label}
                </button>
              ))}
            </div>
          )}

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
