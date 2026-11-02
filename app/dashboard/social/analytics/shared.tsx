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
import TintCard from '../../ui/TintCard'
import { PostExtras, type PostExtrasData } from './PostExtras'
import { CAL_TZ } from '@/app/lib/gcal-core'
import { ANALYTICS_PERIODS, customRange, isPeriod, periodRange, rangeWords, type AnalyticsPeriod } from '@/app/lib/analytics-period-core'
import {
  FRESHNESS_RULES, METRIC_WORDS, engagement, freshnessFor, pictureExpired, type AnalyticsPost, type Metrics, type TimelineDay,
} from '@/app/lib/social-analytics-core'

export type Picked = AnalyticsPeriod | 'custom'

const todayHere = () => new Date().toLocaleDateString('en-CA', { timeZone: CAL_TZ })

/**
 * The days picked live in the address (`?period=`, or `?period=custom&from=&to=` for dates typed in), so they carry
 * from the client to the channel to a shared link.
 */
export function usePeriod(fallback: AnalyticsPeriod) {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const raw = params.get('period')
  const typed = raw === 'custom' ? customRange(params.get('from'), params.get('to'), todayHere()) : null
  const period: Picked = typed ? 'custom' : isPeriod(raw) ? raw : fallback
  const from = typed?.from, to = typed?.to
  const range = useMemo(
    () => (from && to ? { from, to } : periodRange(period as AnalyticsPeriod, todayHere())!),
    [period, from, to])
  const go = useCallback((set: Record<string, string>) => {
    const q = new URLSearchParams(params.toString())
    q.delete('from'); q.delete('to')
    for (const [k, v] of Object.entries(set)) q.set(k, v)
    router.replace(`${pathname}?${q}`, { scroll: false })
  }, [params, pathname, router])
  const setPeriod = useCallback((p: AnalyticsPeriod) => go({ period: p }), [go])
  const setCustom = useCallback((r: { from: string; to: string }) => go({ period: 'custom', from: r.from, to: r.to }), [go])
  const query = period === 'custom' ? `period=custom&from=${range.from}&to=${range.to}` : `period=${period}`
  return { period, range, setPeriod, setCustom, query }
}

/** The days to show: a ready-made period, or "Custom dates" and two days typed in (at most 366 days, none ahead). */
export function PeriodPicker({ period, range, onChange, onCustom }: {
  period: Picked; range: { from: string; to: string }
  onChange: (p: AnalyticsPeriod) => void; onCustom: (r: { from: string; to: string }) => void
}) {
  const [choosing, setChoosing] = useState(period === 'custom')
  const [from, setFrom] = useState(range.from)
  const [to, setTo] = useState(range.to)
  useEffect(() => { setFrom(range.from); setTo(range.to) }, [range.from, range.to])
  useEffect(() => { if (period === 'custom') setChoosing(true) }, [period])
  const today = todayHere()
  const typed = customRange(from, to, today)
  const changed = !!typed && (typed.from !== range.from || typed.to !== range.to || period !== 'custom')
  const custom = choosing || period === 'custom'

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={custom ? 'custom' : period}
          onValueChange={v => { if (v === 'custom') setChoosing(true); else { setChoosing(false); onChange(v as AnalyticsPeriod) } }}>
          <SelectTrigger className="w-44" aria-label="Which days"><SelectValue /></SelectTrigger>
          <SelectContent>
            {ANALYTICS_PERIODS.map(p => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}
            <SelectItem value="custom">Custom dates…</SelectItem>
          </SelectContent>
        </Select>
        {!custom && <span className="font-mono text-secondary-13 tabular-nums text-muted-foreground">{rangeWords(range)}</span>}
      </div>
      {custom && (
        <form className="flex flex-wrap items-center gap-2" onSubmit={e => { e.preventDefault(); if (typed) onCustom(typed) }}>
          <label className="flex items-center gap-1.5 text-secondary-13 text-muted-foreground">From
            <input type="date" value={from} max={today} onChange={e => setFrom(e.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1 text-body-15 text-foreground" />
          </label>
          <label className="flex items-center gap-1.5 text-secondary-13 text-muted-foreground">To
            <input type="date" value={to} max={today} onChange={e => setTo(e.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1 text-body-15 text-foreground" />
          </label>
          <button type="submit" disabled={!changed}
            className="rounded-md bg-foreground px-3 py-1.5 text-secondary-13 font-medium text-background disabled:opacity-40">
            Show
          </button>
          {!typed && <span className="basis-full text-[12px] text-destructive sm:text-right">Pick a start before the end, no later than today, up to 366 days.</span>}
        </form>
      )}
    </div>
  )
}

/** "+85 since 1 Sep" — the change over the days picked, from the first reading inside them; nothing when there is none. */
export function followerWords(growth: number | null | undefined, since: string | null | undefined): string | null {
  if (typeof growth !== 'number' || !since) return null
  const day = new Date(`${since}T00:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  return `${growth > 0 ? '+' : ''}${growth.toLocaleString('en-AU')} since ${day}`
}

const when = (iso: string) => new Date(iso).toLocaleString('en-AU', { timeZone: CAL_TZ, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

/**
 * HOW UP TO DATE THIS IS (the owner, 2 Nov 2026: "mention when the data is full, like the reporting page … so we know
 * when the data is"): whether the days picked are complete, when the numbers and the followers were last read, and
 * how often each kind of number is renewed.
 */
export function FreshnessCard({ range, asOf, followersReadAt }: {
  range: { from: string; to: string }; asOf: string | null; followersReadAt?: string | null
}) {
  const f = freshnessFor(range, todayHere())
  return (
    <TintCard tone={f.tone} title={f.title}>
      <div className="flex flex-col gap-1 text-[14px]">
        <p>{f.words}</p>
        <p className="text-[13px] text-muted-foreground">
          {asOf ? `Post numbers last read ${when(asOf)}` : 'When the post numbers were last read is not known'}
          {followersReadAt ? ` · followers counted ${when(followersReadAt)}` : ''}
        </p>
      </div>
      <details className="-mt-2 text-[13px]">
        <summary className="cursor-pointer font-semibold">How up to date each number is</summary>
        <ul className="mt-1.5 flex flex-col gap-0.5">
          {FRESHNESS_RULES.map(r => <li key={r.what}><strong>{r.what}</strong>: {r.how}</li>)}
        </ul>
      </details>
    </TintCard>
  )
}

/** The newest of several moments (ISO), or null. */
export const newest = (list: (string | null | undefined)[]): string | null =>
  list.filter((x): x is string => !!x).sort().pop() ?? null

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
export function TotalsRow({ followers, followerNote, posts, totals }: {
  followers?: number | null; followerNote?: string | null; posts: number; totals: Metrics
}) {
  const withFollowers = followers !== undefined
  return (
    <div className={`grid grid-cols-2 gap-3 ${withFollowers ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}>
      {withFollowers && <Stat label="Followers" value={followers} hint={followerNote ? `today · ${followerNote}` : 'today'} />}
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
export function Thumb({ src, platform, className = '' }: { src: string | null; platform?: string | null; className?: string }) {
  const [broken, setBroken] = useState(false)
  // a TikTok picture link that has run out cannot be opened by anyone — say so instead of drawing a broken image
  const expired = pictureExpired(src, Date.now())
  if (!src || broken || expired) {
    const word = platform ? brandFor(platform).label : null
    return (
      <div className={`flex flex-col items-center justify-center gap-1 bg-muted text-center text-muted-foreground ${className}`}
        title={word ? `${word} no longer gives this post's picture — open it on ${word} to see it` : 'No picture for this post'}>
        {platform ? <PlatformIcon platform={platform} size={18} /> : <ImageOff className="h-4 w-4" />}
        <span className="px-1 text-[10px] leading-tight">{src ? 'Picture expired' : 'No picture'}</span>
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
      <Thumb src={post.thumbnail} platform={post.platform} className="h-14 w-14 shrink-0 rounded-md" />
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
  const [extras, setExtras] = useState<PostExtrasData | null>(null)
  useEffect(() => {
    setTimeline(null); setFresh(null); setExtras(null)
    if (!post) return
    let live = true
    fetch(`/api/social/analytics/post?id=${encodeURIComponent(post.id)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        if (!live) return
        setTimeline(j?.timeline ?? []); setFresh(j?.post ?? null)
        if (j) setExtras({ deep: j.deep ?? null, collaborators: j.collaborators ?? null, collaboratorsProblem: j.collaboratorsProblem ?? null, linkedin: j.linkedin ?? null })
      })
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
              <SheetDescription>
                Posted {postedOn(p.publishedAt)}{p.updatedAt ? ` · numbers read ${when(p.updatedAt)}` : ''}
              </SheetDescription>
            </SheetHeader>

            <div className="flex gap-3">
              <Thumb src={p.thumbnail} platform={p.platform} className="h-24 w-24 shrink-0 rounded-md" />
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

            {extras && <PostExtras data={extras} platform={p.platform} />}

            <div>
              <h3 className="mb-2 text-card-title">Day by day</h3>
              {timeline === null ? <Skeleton className="h-28 w-full" />
                : timeline.length === 0 ? (
                  <p className="text-secondary-13 text-muted-foreground">No day-by-day figures for this post yet.</p>
                ) : <Growth days={timeline} />}
            </div>
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
