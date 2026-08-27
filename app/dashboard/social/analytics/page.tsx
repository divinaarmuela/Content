'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { ArrowLeft, Clock, ExternalLink, TrendingUp } from 'lucide-react'
import PlatformIcon, { brandFor } from '../PlatformIcon'
import { LoadFailed } from '../../NotSetUp'
import { CAL_TZ } from '@/app/lib/gcal-core'
import { zoneAbbrev, zoneLabel } from '@/app/lib/timezone-core'

type Account = {
  id: string; client_id: string | null; platform: string
  provider_account_id: string; username: string | null
}
type Client = { id: string; name: string }
type DailyPoint = {
  date: string
  metrics?: Record<string, number>
  platformMetrics?: Record<string, Record<string, number>>
}
type Post = {
  _id?: string; content?: string; publishedAt?: string; status?: string
  analytics?: Record<string, number | undefined>
  platforms?: { platform?: string; accountId?: string; platformPostUrl?: string }[]
}

/** One "post at this time" suggestion, normalised from whatever shape the
 *  provider returns (array of slots, day-keyed object, nested `data`…). */
type BestSlot = { day: number; hour: number; score: number }

const DAY_LABEL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_INDEX: Record<string, number> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5, saturday: 6, sat: 6,
}

function toDay(v: unknown): number | null {
  if (typeof v === 'number' && v >= 0 && v <= 6) return v
  if (typeof v === 'string') {
    const byName = DAY_INDEX[v.trim().toLowerCase()]
    if (byName !== undefined) return byName
    const n = Number(v)
    if (Number.isInteger(n) && n >= 0 && n <= 6) return n
  }
  return null
}

function toHour(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v.replace(/[^\d.]/g, '')) : v
  if (typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 23) return Math.floor(n)
  return null
}

function parseBestTimes(raw: unknown): BestSlot[] {
  if (!raw || typeof raw !== 'object') return []
  const r = raw as Record<string, unknown>
  // client-scoped responses arrive as one entry per account — merge them,
  // keeping the strongest score where the same day+hour appears twice
  if (Array.isArray(r.sources)) {
    const best = new Map<string, BestSlot>()
    for (const slot of r.sources.flatMap(parseBestTimes)) {
      const key = `${slot.day}-${slot.hour}`
      const prev = best.get(key)
      if (!prev || slot.score > prev.score) best.set(key, slot)
    }
    return [...best.values()]
  }
  const inner = r.data ?? r.bestTimes ?? r.times ?? raw
  const out: BestSlot[] = []

  const pushSlot = (o: Record<string, unknown>, dayHint?: unknown) => {
    const day = toDay(o.day ?? o.dayOfWeek ?? o.weekday ?? dayHint)
    const hour = toHour(o.hour ?? o.time ?? o.hourOfDay)
    if (day === null || hour === null) return
    const s = o.score ?? o.engagement ?? o.value ?? o.avgEngagement
    out.push({ day, hour, score: typeof s === 'number' ? s : 1 })
  }

  if (Array.isArray(inner)) {
    for (const item of inner) {
      if (item && typeof item === 'object') pushSlot(item as Record<string, unknown>)
    }
  } else if (inner && typeof inner === 'object') {
    // { monday: [{hour, score}, …] | [18, 20] } style
    for (const [key, val] of Object.entries(inner as Record<string, unknown>)) {
      const day = toDay(key)
      if (day === null || !Array.isArray(val)) continue
      for (const item of val) {
        if (item && typeof item === 'object') pushSlot(item as Record<string, unknown>, key)
        else {
          const hour = toHour(item)
          if (hour !== null) out.push({ day, hour, score: 1 })
        }
      }
    }
  }
  return out
}

function hourLabel(h: number) {
  if (h === 0) return '12am'
  if (h < 12) return `${h}am`
  if (h === 12) return '12pm'
  return `${h - 12}pm`
}

const METRICS: [string, string][] = [
  ['impressions', 'Impressions'], ['reach', 'Reach'], ['likes', 'Likes'],
  ['comments', 'Comments'], ['shares', 'Shares'], ['saves', 'Saves'],
]

function when(iso?: string) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '—'
}

/**
 * Analytics across every connected account.
 *
 * Ordered the way it gets read: the totals that answer "how did we do", then
 * the trend, then the posts that produced it. Everything is filterable to one
 * client because that is the unit a report is written about.
 */
export default function SocialAnalyticsPage() {
  const [data, setData] = useState<{
    accounts: Account[]; clients: Client[]
    daily: { dailyData?: DailyPoint[]; platformBreakdown?: Record<string, number>[] } | null
    followers: { accounts?: { _id: string; currentFollowers?: number; growth?: number }[] } | null
    analytics: { posts?: Post[]; overview?: Record<string, number> } | null
    bestTimes?: unknown
  } | null>(null)
  const [clientId, setClientId] = useState<string>('all')
  const [failed, setFailed] = useState<string | null>(null)

  // refetched per client: daily and best-times come from the provider already
  // scoped to that client's accounts, not filtered after the fact
  const load = useCallback(async () => {
    setFailed(null)
    try {
      const res = await fetch(`/api/social/analytics${clientId === 'all' ? '' : `?clientId=${encodeURIComponent(clientId)}`}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load analytics')
      setData(json)
    } catch (e) {
      // a failed load used to leave the page on skeletons forever, which
      // reads as "still thinking" and never stops
      console.error('[analytics] load failed', e)
      setFailed(e instanceof Error ? e.message : 'unknown')
      toast.error('We couldn’t load the numbers. Try again in a moment.')
    }
  }, [clientId])

  useEffect(() => { load() }, [load])

  const scoped = useMemo(() => {
    if (!data) return null
    const accounts = clientId === 'all'
      ? data.accounts
      : data.accounts.filter(a => a.client_id === clientId)
    const ids = new Set(accounts.map(a => a.provider_account_id))

    const posts = (data.analytics?.posts ?? []).filter(p =>
      clientId === 'all' || p.platforms?.some(x => x.accountId && ids.has(x.accountId)))

    const totals: Record<string, number> = {}
    for (const p of posts) {
      for (const [k] of METRICS) {
        const v = p.analytics?.[k]
        if (typeof v === 'number') totals[k] = (totals[k] ?? 0) + v
      }
    }

    const followers = (data.followers?.accounts ?? [])
      .filter(f => ids.has(f._id))
      .reduce((sum, f) => sum + (f.currentFollowers ?? 0), 0)

    return { accounts, posts, totals, followers }
  }, [data, clientId])

  if (failed && !data) {
    return (
      <div className="flex flex-col gap-4">
        <Back />
        <LoadFailed what="the numbers for these accounts" detail={failed} onRetry={() => load()} />
      </div>
    )
  }

  if (!data || !scoped) {
    return (
      <div className="flex flex-col gap-4">
        <Back />
        <div className="grid gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-20" />)}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const daily = data.daily?.dailyData ?? []
  const bestSlots = parseBestTimes(data.bestTimes)

  return (
    <div className="flex flex-col gap-4">
      <Back />

      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Social analytics</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Performance across every connected account. Figures come from the
            platforms themselves and can lag by up to 48 hours.
          </p>
        </div>
        <div className="ml-auto">
          <Select value={clientId} onValueChange={setClientId}>
            <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All clients</SelectItem>
              {data.clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* headline numbers ── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Followers" value={scoped.followers} />
        <Stat label="Posts" value={scoped.posts.length} />
        <Stat label="Impressions" value={scoped.totals.impressions ?? 0} />
        <Stat label="Reach" value={scoped.totals.reach ?? 0} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(['likes', 'comments', 'shares', 'saves'] as const).map(k => (
          <Stat key={k} label={k[0].toUpperCase() + k.slice(1)} value={scoped.totals[k] ?? 0} subtle />
        ))}
      </div>

      {/* channels ── */}
      <Card>
        <CardContent className="p-4">
          <h3 className="mb-3 text-sm font-semibold tracking-tight">Channels</h3>
          {scoped.accounts.length === 0 ? (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">No connected channels.</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {scoped.accounts.map(a => {
                const f = data.followers?.accounts?.find(x => x._id === a.provider_account_id)
                return (
                  <li key={a.id}>
                    <Link href={`/dashboard/social/${a.id}`}
                      className="flex items-center gap-3 rounded-lg border border-zinc-200 p-2.5 transition-colors hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700">
                      <PlatformIcon platform={a.platform} size={28} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {a.username ? `@${a.username}` : brandFor(a.platform).label}
                        </p>
                        <p className="font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                          {(f?.currentFollowers ?? 0).toLocaleString()} followers
                          {typeof f?.growth === 'number' && f.growth !== 0 &&
                            ` · ${f.growth > 0 ? '+' : ''}${f.growth}`}
                        </p>
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* trend ── */}
      {daily.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold tracking-tight">
              <TrendingUp className="h-3.5 w-3.5 text-zinc-400" /> Impressions by day
            </h3>
            <Bars points={daily} />
          </CardContent>
        </Card>
      )}

      {/* when to post ── */}
      {bestSlots.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold tracking-tight">
              <Clock className="h-3.5 w-3.5 text-zinc-400" /> Best times to post
            </h3>
            {/* For a Manila scheduler posting to an Australian audience, the
                zone is the single most consequential fact on this page — and
                nothing on screen named one. */}
            <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
              When the audience has engaged most, from your connected accounts&rsquo;
              history. Times are {zoneLabel(CAL_TZ)} ({zoneAbbrev(CAL_TZ)}) — where
              the audience is, not where you are.
            </p>
            <BestTimes slots={bestSlots} />
          </CardContent>
        </Card>
      )}

      {/* posts, best first ── */}
      <Card>
        <CardContent className="p-4">
          <h3 className="mb-3 text-sm font-semibold tracking-tight">
            Top posts <span className="font-normal text-zinc-400 dark:text-zinc-500">by impressions</span>
          </h3>
          {scoped.posts.length === 0 ? (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Nothing published yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
                    <th className="pb-2 font-medium">Post</th>
                    {METRICS.map(([, label]) => (
                      <th key={label} className="pb-2 text-right font-medium">{label}</th>
                    ))}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {[...scoped.posts]
                    .sort((a, b) => (b.analytics?.impressions ?? 0) - (a.analytics?.impressions ?? 0))
                    .map((p, i) => {
                      const url = p.platforms?.find(x => x.platformPostUrl)?.platformPostUrl
                      return (
                        <tr key={p._id ?? i} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                          <td className="max-w-[280px] py-2 pr-3">
                            <p className="truncate">{p.content || '(no caption)'}</p>
                            <p className="text-xs text-zinc-400 dark:text-zinc-500">
                              {when(p.publishedAt)}
                            </p>
                          </td>
                          {METRICS.map(([k]) => (
                            <td key={k} className="py-2 text-right font-mono tabular-nums">
                              {typeof p.analytics?.[k] === 'number' ? p.analytics[k]!.toLocaleString() : '—'}
                            </td>
                          ))}
                          <td className="py-2 pl-2 text-right">
                            {url && (
                              <a href={url} target="_blank" rel="noopener noreferrer"
                                 className="text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100">
                                <ExternalLink className="h-3.5 w-3.5" />
                              </a>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Back() {
  return (
    <Link href="/dashboard/social"
      className="inline-flex w-fit items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
      <ArrowLeft className="h-3.5 w-3.5" /> Social channels
    </Link>
  )
}

function Stat({ label, value, subtle }: { label: string; value: number; subtle?: boolean }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
        <p className={`font-mono tabular-nums ${subtle ? 'text-lg' : 'text-2xl'}`}>
          {value.toLocaleString()}
        </p>
      </CardContent>
    </Card>
  )
}

/** Top suggested slots as chips, then a day × hour heat grid. One hue only —
 *  intensity carries the magnitude; the exact figure lives in the tooltip. */
function BestTimes({ slots }: { slots: BestSlot[] }) {
  const max = Math.max(...slots.map(s => s.score), 0.0001)
  const top = [...slots].sort((a, b) => b.score - a.score).slice(0, 3)
  const byCell = new Map(slots.map(s => [`${s.day}-${s.hour}`, s.score]))
  const hours = [...new Set(slots.map(s => s.hour))].sort((a, b) => a - b)
  // pad the grid a little either side so single hours don't float alone
  const lo = Math.max(0, (hours[0] ?? 8) - 1)
  const hi = Math.min(23, (hours[hours.length - 1] ?? 20) + 1)
  const range = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {top.map((s, i) => (
          <span key={`${s.day}-${s.hour}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200">
            {i === 0 && <span className="text-[10px] uppercase tracking-wide text-blue-600 dark:text-blue-400">best</span>}
            {DAY_LABEL[s.day]} {hourLabel(s.hour)}
          </span>
        ))}
      </div>

      {/* 20x14px cells whose only content was a hover tooltip: on a phone
          this was a grid of meaningless coloured squares. The ranked pills
          above say the same thing in words, so below `md` they are all of it. */}
      <div className="hidden overflow-x-auto md:block">
        <div className="min-w-[420px]">
          {DAY_LABEL.map((label, day) => (
            <div key={label} className="flex items-center gap-1.5 py-0.5">
              <span className="w-8 shrink-0 text-[11px] text-zinc-500 dark:text-zinc-400">{label}</span>
              {range.map(h => {
                const score = byCell.get(`${day}-${h}`)
                return (
                  <div key={h}
                    title={score !== undefined ? `${label} ${hourLabel(h)} — strong time to post` : `${label} ${hourLabel(h)}`}
                    className="h-5 flex-1 rounded-[3px]"
                    style={{
                      minWidth: 14,
                      background: score !== undefined
                        ? `rgba(37, 99, 235, ${0.25 + 0.75 * (score / max)})`
                        : 'var(--best-times-empty, rgba(161,161,170,0.12))',
                    }} />
                )
              })}
            </div>
          ))}
          <div className="mt-1 flex items-center gap-1.5">
            <span className="w-8 shrink-0" />
            {range.map(h => (
              <span key={h} className="flex-1 text-center text-[10px] text-zinc-400 dark:text-zinc-500" style={{ minWidth: 14 }}>
                {h % 3 === 0 ? hourLabel(h) : ''}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Fixed-width bars: a flexed bar with one data point fills the panel and
 *  reads as a block rather than a chart. */
function Bars({ points }: { points: DailyPoint[] }) {
  const recent = points.slice(-21)
  const max = Math.max(1, ...recent.map(p => p.metrics?.impressions ?? 0))
  return (
    <div>
      <div className="flex items-end gap-1.5 overflow-x-auto pb-1" style={{ height: 110 }}>
        {recent.map(p => {
          const v = p.metrics?.impressions ?? 0
          return (
            <div key={p.date} className="flex w-10 shrink-0 flex-col items-center gap-1">
              <span className="font-mono text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">{v}</span>
              <div className="w-full rounded-t bg-zinc-400 dark:bg-zinc-600"
                   style={{ height: Math.max(3, (v / max) * 68) }}
                   title={`${p.date} · ${v} impressions`} />
              <span className="text-[10px] text-zinc-400 dark:text-zinc-500">{p.date.slice(5)}</span>
            </div>
          )
        })}
      </div>
      <p className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">
        Impressions per day{recent.length === 1 ? ' — only one day of data so far' : ''}
      </p>
    </div>
  )
}
