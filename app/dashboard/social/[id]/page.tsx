'use client'

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertTriangle, ArrowLeft, CheckCircle2, ExternalLink,
  KeyRound, MessageSquare, RefreshCw, XCircle,
} from 'lucide-react'
import PlatformIcon, { brandFor } from '../PlatformIcon'
import { tokenNotice } from '../../../lib/token-health-core'
import { Button } from '@/components/ui/button'

/* ── shapes (kept loose: the provider owns them) ───────────────────────── */

type Account = {
  id: string; client_id: string | null; platform: string
  provider_account_id: string; name: string | null; username: string | null
  avatar_url: string | null; active: boolean; connected_at: string
}

type Scope = { scope: string; granted: boolean; required?: boolean }

type Health = {
  status?: string
  tokenStatus?: { valid?: boolean; expiresAt?: string; expiresIn?: string; needsRefresh?: boolean }
  permissions?: Record<string, Scope[]>
}
type Insights = {
  metrics?: Record<string, { total?: number }>
  dateRange?: { since?: string; until?: string }
  dataDelay?: string
}
type DailyPoint = { date: string; metrics?: Record<string, number> }
type PostMetrics = Record<string, number | undefined>
type Post = {
  _id?: string; content?: string; status?: string
  createdAt?: string; publishedAt?: string
  analytics?: PostMetrics
  platforms?: { platform?: string; platformPostUrl?: string; accountId?: string }[]
}
type Analytics = {
  overview?: { totalPosts?: number; publishedPosts?: number; scheduledPosts?: number }
  posts?: Post[]
}

/** The per-post numbers worth showing, in the order an editor reads them. */
const POST_METRICS: [string, string][] = [
  ['impressions', 'Impressions'], ['reach', 'Reach'], ['likes', 'Likes'],
  ['comments', 'Comments'], ['shares', 'Shares'], ['saves', 'Saves'],
]
type Comment = {
  id?: string; accountId?: string; content?: string; createdTime?: string
  permalink?: string; picture?: string; commentCount?: number
}

type Payload = {
  account: Account
  client: { id: string; name: string } | null
  health: Health | null
  insights: Insights | null
  daily: { dailyData?: DailyPoint[] } | null
  followers: { accounts?: { _id: string; currentFollowers?: number; growth?: number }[] } | null
  posts: { posts?: Post[] } | null
  analytics: Analytics | null
  comments: { data?: Comment[] } | null
}

const METRIC_LABEL: Record<string, string> = {
  reach: 'Reach', views: 'Views', accounts_engaged: 'Accounts engaged',
  total_interactions: 'Interactions', impressions: 'Impressions',
  likes: 'Likes', comments: 'Comments', shares: 'Shares', saves: 'Saves',
}

function when(iso?: string): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

export default function AccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reconnecting, setReconnecting] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/social/accounts/${id}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load this account')
      setData(json)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not load this account'
      setError(msg); toast.error(msg)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  /** The same POST /api/social/connect the Connect dropdown uses, aimed at the
   *  account already on screen. A full navigation, not a popup: the platforms'
   *  consent screens refuse to be framed and popups get blocked. */
  const reconnect = async () => {
    if (!data) return
    setReconnecting(true)
    try {
      const res = await fetch('/api/social/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: data.account.client_id, platform: data.account.platform }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not start the reconnection')
      window.location.href = json.authUrl
    } catch (e) {
      console.error('[social] reconnect failed', e)
      toast.error('We could not open the login screen. Try again in a moment.')
      setReconnecting(false)
    }
  }

  if (error) {
    return (
      <div className="flex flex-col gap-4">
        <Back />
        <Card><CardContent className="p-6 text-sm text-red-600 dark:text-red-400">{error}</CardContent></Card>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex flex-col gap-4">
        <Back />
        <Skeleton className="h-24 w-full" />
        <div className="grid gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-20" />)}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const { account, client, health, insights, daily, followers, posts, comments } = data
  const brand = brandFor(account.platform)
  const token = health?.tokenStatus
  const scopes = Object.entries(health?.permissions ?? {})
  const missing = scopes.flatMap(([, list]) => list).filter(s => !s.granted && s.required)

  // The token's own story, decided by the provider rather than by a countdown.
  // Missing scopes are a separate panel with its own wording, so they are ORed
  // in for the BUTTON only — the one rule being that nothing on this page tells
  // anyone to press a button that is not rendered.
  const notice = tokenNotice(token, Date.now())
  const needsReconnect = (notice?.needsReconnect ?? false) || missing.length > 0

  const followerRow = followers?.accounts?.find(a => a._id === account.provider_account_id)
  const metrics = Object.entries(insights?.metrics ?? {})
  const myComments = (comments?.data ?? []).filter(c => c.accountId === account.provider_account_id)
  const overview = data.analytics?.overview

  // /analytics is the richer source: it carries per-post metrics and includes
  // posts published directly on the platform, which /posts does not.
  const analysedPosts = (data.analytics?.posts ?? []).filter(p =>
    p.platforms?.some(x => x.accountId === account.provider_account_id))

  return (
    <div className="flex flex-col gap-4">
      <Back />

      {/* ── identity + health ─────────────────────────────────────────── */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 p-4">
          <PlatformIcon platform={account.platform} size={48} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold tracking-tight">
                {account.username ? `@${account.username}` : account.name ?? brand.label}
              </h2>
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                {brand.label}
              </span>
              {token?.valid
                ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                    <CheckCircle2 className="h-3 w-3" /> Healthy
                  </span>
                : <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] text-red-700 dark:bg-red-950/40 dark:text-red-400">
                    <XCircle className="h-3 w-3" /> Needs reconnecting
                  </span>}
            </div>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              {client
                ? <>Publishing for <Link href="/dashboard/social" className="underline decoration-dotted">{client.name}</Link></>
                : 'Not linked to a client'}
              {' · '}connected {when(account.connected_at)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* This page told a scheduler THREE times, urgently, to reconnect
                — and gave them no way to do it. The connect flow lived in a
                dropdown on another page. It is the same call; it now lives
                where the warning is. */}
            {needsReconnect && (
              <Button size="sm" onClick={() => void reconnect()} disabled={reconnecting}>
                <RefreshCw className={`h-3.5 w-3.5 ${reconnecting ? 'animate-spin' : ''}`} />
                {reconnecting ? 'Opening the login screen…' : 'Reconnect account'}
              </Button>
            )}
            <Link
              href={`/dashboard/social/inbox?account=${encodeURIComponent(account.provider_account_id)}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 px-3 py-1.5 text-sm transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
            >
              <MessageSquare className="h-3.5 w-3.5" /> Inbox
            </Link>
          </div>
        </CardContent>
      </Card>

      {/* An expiry date only breaks publishing when nothing renews it. Which
          of those this is, is the provider's to say — not a fortnight rule
          that fired on every TikTok and YouTube account from the day it was
          connected, and pointed at a button it had not rendered. */}
      {notice && (
        <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
          notice.level === 'act'
            ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300'
            : notice.level === 'watch'
            ? 'border-amber-200 text-amber-800 dark:border-amber-900 dark:text-amber-300'
            : 'border-zinc-200 text-zinc-600 dark:border-zinc-800 dark:text-zinc-400'
        }`}>
          <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {token?.expiresAt
              ? <>Access token expires {when(token.expiresAt)}
                  {notice.autoRenews && token.expiresIn ? ` — ${token.expiresIn}` : ''}. </>
              : null}
            {notice.advice}
          </span>
        </div>
      )}

      {missing.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {/* the raw scope strings ("instagram_manage_comments") meant
              nothing to anyone reading this page; the instruction does */}
          <span>
            This account is missing {missing.length > 1 ? 'some of the permissions' : 'a permission'} we
            need. Press <strong>Reconnect account</strong> above, and when the
            login screen appears, tick every permission it asks for.
          </span>
        </div>
      )}

      {/* ── numbers ───────────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Followers"
          value={followerRow?.currentFollowers ?? null}
          sub={typeof followerRow?.growth === 'number' && followerRow.growth !== 0
            ? `${followerRow.growth > 0 ? '+' : ''}${followerRow.growth} recently`
            : undefined}
        />
        {metrics.slice(0, 3).map(([k, v]) => (
          <Stat key={k} label={METRIC_LABEL[k] ?? k.replace(/_/g, ' ')} value={v?.total ?? null} />
        ))}
        {metrics.length === 0 && (
          <Card className="sm:col-span-2 lg:col-span-3">
            <CardContent className="p-4 text-xs text-zinc-500 dark:text-zinc-400">
              No insights available for this account yet. Platforms only report figures
              once there is activity, and {brand.label} data can lag by up to 48 hours.
            </CardContent>
          </Card>
        )}
      </div>

      {insights?.dateRange?.since && (
        <p className="-mt-2 text-xs text-zinc-400 dark:text-zinc-500">
          {insights.dateRange.since} → {insights.dateRange.until}
          {insights.dataDelay ? ` · ${insights.dataDelay}` : ''}
        </p>
      )}

      {/* ── daily trend ───────────────────────────────────────────────── */}
      {(daily?.dailyData?.length ?? 0) > 0 && (
        <Card>
          <CardContent className="p-4">
            <h3 className="mb-3 text-sm font-semibold tracking-tight">Recent daily activity</h3>
            <Trend points={daily!.dailyData!} />
          </CardContent>
        </Card>
      )}

      {/* ── posts, with their own numbers ─────────────────────────────── */}
      <Card>
        <CardContent className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <h3 className="text-sm font-semibold tracking-tight">
              Posts <span className="font-normal text-zinc-400 dark:text-zinc-500">({analysedPosts.length})</span>
            </h3>
            {overview && (
              <span className="ml-auto text-xs text-zinc-500 dark:text-zinc-400">
                {overview.publishedPosts ?? 0} published · {overview.scheduledPosts ?? 0} scheduled
              </span>
            )}
          </div>

          {analysedPosts.length === 0 ? (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              No posts found for this account yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {analysedPosts.map((p, i) => {
                const m = p.analytics ?? {}
                const url = p.platforms?.find(x => x.platformPostUrl)?.platformPostUrl
                return (
                  <li key={p._id ?? i} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{p.content || '(no caption)'}</p>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                          {p.status ?? 'published'} · {when(p.publishedAt ?? p.createdAt)}
                          {typeof m.engagementRate === 'number' && m.engagementRate > 0 &&
                            ` · ${m.engagementRate.toFixed(1)}% engagement`}
                        </p>
                      </div>
                      {url && (
                        <a href={url} target="_blank" rel="noopener noreferrer"
                           className="shrink-0 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
                           title="Open on the platform">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>

                    {/* per-post metrics — the numbers that say whether it worked */}
                    <dl className="mt-2 grid grid-cols-3 gap-x-4 gap-y-1 sm:grid-cols-6">
                      {POST_METRICS.map(([k, label]) => (
                        <div key={k}>
                          <dt className="text-[11px] text-zinc-500 dark:text-zinc-400">{label}</dt>
                          <dd className="font-mono text-sm tabular-nums">
                            {typeof m[k] === 'number' ? (m[k] as number).toLocaleString() : '—'}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ── comments ──────────────────────────────────────────────────── */}
      <Card>
        <CardContent className="p-4">
          <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold tracking-tight">
            <MessageSquare className="h-3.5 w-3.5 text-zinc-400" />
            Activity <span className="font-normal text-zinc-400 dark:text-zinc-500">({myComments.length})</span>
          </h3>
          {myComments.length === 0 ? (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              No posts with comments found for this account.
            </p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {myComments.map((c, i) => (
                <li key={c.id ?? i} className="flex gap-3 rounded-lg border border-zinc-200 p-2 dark:border-zinc-800">
                  {c.picture && (
                    // provider-hosted CDN image; next/image would need host config
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.picture} alt="" className="h-12 w-12 shrink-0 rounded object-cover" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{c.content || '(no caption)'}</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">{when(c.createdTime)}</p>
                  </div>
                  {c.permalink && (
                    <a href={c.permalink} target="_blank" rel="noopener noreferrer"
                       className="shrink-0 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/* ── pieces ────────────────────────────────────────────────────────────── */

function Back() {
  return (
    <Link
      href="/dashboard/social"
      className="inline-flex w-fit items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
    >
      <ArrowLeft className="h-3.5 w-3.5" /> Social channels
    </Link>
  )
}

function Stat({ label, value, sub }: { label: string; value: number | null; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
        <p className="font-mono text-2xl tabular-nums">
          {value === null ? <span className="text-zinc-300 dark:text-zinc-600">—</span> : value.toLocaleString()}
        </p>
        {sub && <p className="text-xs text-zinc-500 dark:text-zinc-400">{sub}</p>}
      </CardContent>
    </Card>
  )
}

/** Bars for the last fortnight. Deliberately not a chart library — one metric,
 *  one axis, no interaction beyond the value on hover.
 *
 *  Bars are a fixed width rather than flexed: with a single day of data a
 *  flexed bar stretches to the full panel width and reads as a solid block,
 *  not a chart. */
function Trend({ points }: { points: DailyPoint[] }) {
  const recent = points.slice(-14)
  const max = Math.max(1, ...recent.map(p => p.metrics?.impressions ?? 0))

  return (
    <div>
      <div className="flex items-end gap-1.5 overflow-x-auto pb-1" style={{ height: 96 }}>
        {recent.map(p => {
          const v = p.metrics?.impressions ?? 0
          return (
            <div key={p.date} className="flex w-9 shrink-0 flex-col items-center gap-1">
              <span className="font-mono text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
                {v}
              </span>
              <div
                className="w-full rounded-t bg-zinc-400 dark:bg-zinc-600"
                style={{ height: Math.max(3, (v / max) * 56) }}
                title={`${p.date} · ${v} impressions`}
              />
              <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
                {p.date.slice(5)}
              </span>
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
