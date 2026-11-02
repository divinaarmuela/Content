'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ChevronRight, ExternalLink, ImageOff } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import PlatformIcon, { brandFor } from '../PlatformIcon'
import { CAL_TZ } from '@/app/lib/gcal-core'
import { ANALYTICS_PERIODS, isPeriod, periodRange, rangeWords, type AnalyticsPeriod } from '@/app/lib/analytics-period-core'
import {
  METRIC_WORDS, engagement, type AnalyticsPost, type Metrics, type TimelineDay,
} from '@/app/lib/social-analytics-core'

/** The period lives in the address (`?period=`), so it carries from the client to the channel to a shared link. */
export function usePeriod(fallback: AnalyticsPeriod) {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const raw = params.get('period')
  const period: AnalyticsPeriod = isPeriod(raw) ? raw : fallback
  const range = useMemo(
    () => periodRange(period, new Date().toLocaleDateString('en-CA', { timeZone: CAL_TZ }))!,
    [period])
  const setPeriod = useCallback((p: AnalyticsPeriod) => {
    const q = new URLSearchParams(params.toString())
    q.set('period', p)
    router.replace(`${pathname}?${q}`, { scroll: false })
  }, [params, pathname, router])
  return { period, range, setPeriod, query: `period=${period}` }
}

export function PeriodPicker({ period, range, onChange }: {
  period: AnalyticsPeriod; range: { from: string; to: string }; onChange: (p: AnalyticsPeriod) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={period} onValueChange={v => onChange(v as AnalyticsPeriod)}>
        <SelectTrigger className="w-44" aria-label="Which days"><SelectValue /></SelectTrigger>
        <SelectContent>
          {ANALYTICS_PERIODS.map(p => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}
        </SelectContent>
      </Select>
      <span className="font-mono text-secondary-13 tabular-nums text-muted-foreground">{rangeWords(range)}</span>
    </div>
  )
}

/** Analytics › Client › Channel */
export function Crumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Where you are" className="flex flex-wrap items-center gap-1 text-secondary-13 text-muted-foreground">
      {items.map((it, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          {i > 0 && <ChevronRight className="h-3.5 w-3.5" />}
          {it.href ? <Link href={it.href} className="hover:text-foreground">{it.label}</Link>
            : <span className="text-foreground">{it.label}</span>}
        </span>
      ))}
    </nav>
  )
}

export const n = (v: number | null | undefined) => (typeof v === 'number' ? v.toLocaleString('en-AU') : '—')

export function Stat({ label, value, hint }: { label: string; value: number | null; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-secondary-13 text-muted-foreground">{label}</p>
        <p className="font-mono text-2xl tabular-nums">{n(value)}</p>
        {hint && <p className="text-[12px] text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  )
}

/** Followers, posts, and the numbers that matter most, in one row. */
/** `followers` left out on the all-clients page — a sum of everyone's followers says nothing (the owner, 2 Nov 2026) */
export function TotalsRow({ followers, posts, totals }: { followers?: number | null; posts: number; totals: Metrics }) {
  const withFollowers = followers !== undefined
  return (
    <div className={`grid grid-cols-2 gap-3 ${withFollowers ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}>
      {withFollowers && <Stat label="Followers" value={followers} hint="today" />}
      <Stat label="Posts" value={posts} />
      <Stat label="Views" value={Math.max(totals.views, totals.impressions)} hint={totals.views ? 'plays and views' : 'times shown'} />
      <Stat label="Reach" value={totals.reach} hint="people" />
      <Stat label="Engagement" value={engagement(totals)} hint="likes, comments, shares, saves" />
    </div>
  )
}

export function LoadingBlock() {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{[0, 1, 2, 3, 4].map(i => <Skeleton key={i} className="h-20" />)}</div>
      <Skeleton className="h-48 w-full" />
    </div>
  )
}

/** A platform's picture, or a quiet blank when it has none or the link has expired (Meta's links do). */
export function Thumb({ src, className = '' }: { src: string | null; className?: string }) {
  const [broken, setBroken] = useState(false)
  if (!src || broken) {
    return (
      <div className={`flex items-center justify-center bg-muted text-muted-foreground ${className}`}>
        <ImageOff className="h-4 w-4" />
      </div>
    )
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className={`object-cover ${className}`} />
}

export const postedOn = (iso: string | null) => iso
  ? new Date(iso).toLocaleString('en-AU', { timeZone: CAL_TZ, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  : 'No date'

/** One post as a row: picture, words, when, and its main numbers. The whole row opens the post. */
export function PostRow({ post, onOpen }: { post: AnalyticsPost; onOpen: (p: AnalyticsPost) => void }) {
  const m = post.metrics
  return (
    <button type="button" onClick={() => onOpen(post)}
      className="flex w-full items-center gap-3 rounded-inner border border-border p-2.5 text-left transition-colors hover:border-foreground/25 hover:bg-muted/40">
      <Thumb src={post.thumbnail} className="h-14 w-14 shrink-0 rounded-md" />
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-body-15">{post.content || '(no caption)'}</p>
        <p className="mt-0.5 text-secondary-13 text-muted-foreground">
          {postedOn(post.publishedAt)}{post.mediaType ? ` · ${post.mediaType}` : ''}
        </p>
      </div>
      <dl className="hidden shrink-0 grid-cols-4 gap-4 text-right sm:grid">
        {([['Views', Math.max(m.views, m.impressions)], ['Reach', m.reach], ['Likes', m.likes], ['Comments', m.comments]] as const).map(([k, v]) => (
          <div key={k} className="w-16">
            <dt className="text-[12px] text-muted-foreground">{k}</dt>
            <dd className="font-mono text-body-15 tabular-nums">{n(v)}</dd>
          </div>
        ))}
      </dl>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  )
}

/** One post's numbers: the latest figures, then how they grew day by day. */
export function PostSheet({ post, onClose }: { post: AnalyticsPost | null; onClose: () => void }) {
  const [timeline, setTimeline] = useState<TimelineDay[] | null>(null)
  const [fresh, setFresh] = useState<AnalyticsPost | null>(null)
  useEffect(() => {
    setTimeline(null); setFresh(null)
    if (!post) return
    let live = true
    fetch(`/api/social/analytics/post?id=${encodeURIComponent(post.id)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (live) { setTimeline(j?.timeline ?? []); setFresh(j?.post ?? null) } })
      .catch(() => { if (live) setTimeline([]) })
    return () => { live = false }
  }, [post])

  const p = fresh ?? post
  const brand = p?.platform ? brandFor(p.platform).label : 'the platform'
  return (
    <Sheet open={!!post} onOpenChange={o => { if (!o) onClose() }}>
      <SheetContent side="right" className="w-full overflow-y-auto bg-popover sm:max-w-lg">
        {p && (
          <div className="flex flex-col gap-4">
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                {p.platform && <PlatformIcon platform={p.platform} size={22} />} Post analytics
              </SheetTitle>
              <SheetDescription>{postedOn(p.publishedAt)}</SheetDescription>
            </SheetHeader>

            <div className="flex gap-3">
              <Thumb src={p.thumbnail} className="h-24 w-24 shrink-0 rounded-md" />
              <p className="line-clamp-5 whitespace-pre-line text-body-15">{p.content || '(no caption)'}</p>
            </div>
            {p.url && (
              <a href={p.url} target="_blank" rel="noopener noreferrer"
                className="inline-flex w-fit items-center gap-1.5 text-secondary-13 text-muted-foreground hover:text-foreground">
                <ExternalLink className="h-3.5 w-3.5" /> Open on {brand}
              </a>
            )}

            <div className="grid grid-cols-3 gap-2">
              {METRIC_WORDS.map(([k, label]) => (
                <div key={k} className="rounded-inner border border-border p-2.5">
                  <p className="text-[12px] text-muted-foreground">{label}</p>
                  <p className="font-mono text-lg tabular-nums">{n(p.metrics[k])}</p>
                </div>
              ))}
              <div className="rounded-inner border border-border p-2.5">
                <p className="text-[12px] text-muted-foreground">Engagement rate</p>
                <p className="font-mono text-lg tabular-nums">{p.engagementRate === null ? '—' : `${p.engagementRate}%`}</p>
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-card-title">Day by day</h3>
              {timeline === null ? <Skeleton className="h-28 w-full" />
                : timeline.length === 0 ? (
                  <p className="text-secondary-13 text-muted-foreground">No day-by-day figures for this post yet — {brand} hands them over within a day or two.</p>
                ) : <Growth days={timeline} />}
            </div>
            <p className="text-[12px] text-muted-foreground">From {brand}, through Zernio. Figures can lag by up to 48 hours.</p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

/** The running total each day (views where the post has them, else times shown). */
function Growth({ days }: { days: TimelineDay[] }) {
  const useViews = days.some(d => d.metrics.views > 0)
  const value = (d: TimelineDay) => (useViews ? d.metrics.views : d.metrics.impressions)
  const recent = days.slice(-30)
  const max = Math.max(1, ...recent.map(value))
  const day = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  return (
    <div>
      <div className="flex items-end gap-1 overflow-x-auto pb-1" style={{ height: 120 }}>
        {recent.map(d => (
          <div key={d.date} className="flex w-9 shrink-0 flex-col items-center gap-1" title={`${day(d.date)} · ${n(value(d))}`}>
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{n(value(d))}</span>
            <div className="w-full rounded-t bg-foreground/[0.18]" style={{ height: Math.max(3, (value(d) / max) * 70) }} />
            <span className="text-[11px] text-muted-foreground">{day(d.date)}</span>
          </div>
        ))}
      </div>
      <p className="mt-1 text-[12px] text-muted-foreground">{useViews ? 'Views' : 'Times shown'} so far, as read each day</p>
    </div>
  )
}
