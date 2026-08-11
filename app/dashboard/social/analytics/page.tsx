'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { ArrowLeft, ExternalLink, TrendingUp } from 'lucide-react'
import PlatformIcon, { brandFor } from '../PlatformIcon'

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
  } | null>(null)
  const [clientId, setClientId] = useState<string>('all')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/social/analytics')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load analytics')
      setData(json)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load analytics')
    }
  }, [])

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
