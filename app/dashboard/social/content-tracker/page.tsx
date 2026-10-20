'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, ExternalLink, Eye, Heart, Loader2, MessageCircle, RefreshCw, Share2, Bookmark } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import PageTitle from '../../ui/PageTitle'
import PlatformIcon from '../PlatformIcon'
import TrackerTable from './TrackerTable'
import {
  byClient, compact, monthKey, monthWords, platformsIn, shiftMonth, totals,
  type TrackerLine, type TrackerPost,
} from '../../../lib/content-tracker-core'
import { networkName } from '../../../lib/publish-core'

/**
 * THE CONTENT TRACKER (the owner, 20 Oct 2026: "a posted page which fetches everything that's posted from zernio
 * make it a nice page … month basis client data for the posts"). One month at a time: every post that went live —
 * through the app or straight on the network — per client, per network, with its numbers.
 */

type TrackerClient = { id: string; name: string; logo: string | null }
type Answer = { month: string; lines: TrackerLine[]; posts: TrackerPost[]; clients: TrackerClient[]; addable: { id: string; name: string }[]; complete: boolean; fetchedAt: string }
type Sort = 'newest' | 'views' | 'engagement'
type Via = 'all' | 'app' | 'native'

const ALL = '__all'
const NO_CLIENT = '__none'
const NO_CLIENT_NAME = 'Not linked to a client'
const DAY = new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Australia/Melbourne' })
const TIME = new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Melbourne' })

export default function ContentTrackerPage() {
  const [month, setMonth] = useState(() => monthKey(new Date().toISOString())!)
  const [data, setData] = useState<Answer | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [client, setClient] = useState<string>(ALL)
  const [network, setNetwork] = useState<string>(ALL)
  // ours by default: a connected account's own posts are in Zernio's list too (Pattons, 20 Oct 2026)
  const [via, setVia] = useState<Via>('app')
  const [sort, setSort] = useState<Sort>('newest')
  const [tab, setTab] = useState<'tracker' | 'posts'>('tracker')

  const load = useCallback(async (m: string, fresh = false) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/content-tracker?month=${m}${fresh ? '&fresh=1' : ''}`)
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Could not load the posts')
      setData(j)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the posts')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void load(month) }, [month, load])

  const thisMonth = monthKey(new Date().toISOString())!
  const nameOf = useMemo(() => new Map((data?.clients ?? []).map(c => [c.id, c])), [data])
  const clientName = (id: string | null) => (id ? nameOf.get(id)?.name ?? 'Unknown client' : NO_CLIENT_NAME)

  const all = data?.posts ?? []
  const shown = useMemo(() => {
    const list = all.filter(p =>
      (client === ALL || (client === NO_CLIENT ? p.clientId === null : p.clientId === client))
      && (network === ALL || p.platform === network)
      && (via === 'all' || p.via === via))
    const by = sort === 'views' ? (a: TrackerPost, b: TrackerPost) => b.views - a.views
      : sort === 'engagement' ? (a: TrackerPost, b: TrackerPost) => (b.likes + b.comments + b.shares + b.saves) - (a.likes + a.comments + a.shares + a.saves)
        : (a: TrackerPost, b: TrackerPost) => b.publishedAt.localeCompare(a.publishedAt)
    return [...list].sort(by)
  }, [all, client, network, via, sort])
  const sum = totals(shown)
  const clients = byClient(all.filter(p => (network === ALL || p.platform === network) && (via === 'all' || p.via === via)))
  const networks = platformsIn(all)
  const clientOptions = [...(data?.clients ?? [])].sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="flex flex-col gap-6 pb-12">
      <PageTitle
        title="Content tracker"
        summary="Each client’s month: what they need, what is booked or posted, and every post with its numbers."
        actions={<>
          <div className="flex items-center gap-1 rounded-full border border-border bg-surface p-1">
            <button type="button" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month"
              className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-muted"><ChevronLeft className="h-4 w-4" /></button>
            <span className="min-w-[132px] text-center text-[14px] font-semibold">{monthWords(month)}</span>
            <button type="button" onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= thisMonth} aria-label="Next month"
              className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-muted disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
          </div>
          <button type="button" onClick={() => void load(month, true)} disabled={loading}
            className="inline-flex h-11 items-center gap-2 rounded-full border border-border bg-surface px-4 text-[13px] font-semibold hover:bg-muted disabled:opacity-50">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh
          </button>
        </>}
      />

      <div className="flex items-center gap-1 self-start rounded-full border border-border bg-surface p-1">
        <Pill on={tab === 'tracker'} onClick={() => setTab('tracker')}>Deliverables</Pill>
        <Pill on={tab === 'posts'} onClick={() => setTab('posts')}>Posts and numbers</Pill>
      </div>

      {error && (
        <div className="rounded-inner border border-accent-red/40 bg-accent-red/10 p-4 text-[14px]">
          {error} <button type="button" className="ml-2 font-semibold underline" onClick={() => void load(month, true)}>Try again</button>
        </div>
      )}

      {tab === 'tracker' ? (
        <TrackerTable month={month} lines={data?.lines ?? []} clients={data?.clients ?? []} addable={data?.addable ?? []} loading={loading} onSaved={() => void load(month)} />
      ) : <>
      {/* the filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={client} onValueChange={setClient}>
          <SelectTrigger className="h-10 w-60 rounded-full bg-surface" aria-label="Client"><SelectValue /></SelectTrigger>
          <SelectContent className="bg-popover">
            <SelectItem value={ALL}>Every client</SelectItem>
            {clientOptions.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            {all.some(p => p.clientId === null) && <SelectItem value={NO_CLIENT}>{NO_CLIENT_NAME}</SelectItem>}
          </SelectContent>
        </Select>
        <div className="flex flex-wrap items-center gap-1 rounded-full border border-border bg-surface p-1">
          <Pill on={network === ALL} onClick={() => setNetwork(ALL)}>All networks</Pill>
          {networks.map(n => (
            <Pill key={n} on={network === n} onClick={() => setNetwork(n)} label={networkName(n)}>
              <PlatformIcon platform={n} size={16} />
            </Pill>
          ))}
        </div>
        <div className="flex items-center gap-1 rounded-full border border-border bg-surface p-1">
          <Pill on={via === 'app'} onClick={() => setVia('app')}>Posted by us</Pill>
          <Pill on={via === 'native'} onClick={() => setVia('native')}>Posted by the client</Pill>
          <Pill on={via === 'all'} onClick={() => setVia('all')}>Both</Pill>
        </div>
      </div>

      {/* the month in numbers */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Posts" value={loading && !data ? null : String(sum.posts)} />
        <Stat label="Views" value={loading && !data ? null : compact(sum.views)} />
        <Stat label="Likes" value={loading && !data ? null : compact(sum.likes)} />
        <Stat label="Comments" value={loading && !data ? null : compact(sum.comments)} />
        <Stat label="Shares and saves" value={loading && !data ? null : compact(sum.shares + sum.saves)} />
        <Stat label="Engagement" value={loading && !data ? null : sum.engagementRate === null ? '—' : `${sum.engagementRate}%`}
          hint="Likes, comments, shares and saves, over views" />
      </div>

      {/* each client's month */}
      {client === ALL && (
        <section className="overflow-hidden rounded-inner border border-border bg-surface">
          <header className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-[15px] font-semibold">By client</h2>
            <span className="text-[13px] text-muted-foreground">{clients.length} {clients.length === 1 ? 'client' : 'clients'} posted in {monthWords(month)}</span>
          </header>
          {loading && !data ? (
            <div className="flex flex-col gap-2 p-4">{[0, 1, 2].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : clients.length === 0 ? (
            <p className="p-6 text-center text-[14px] text-muted-foreground">Nothing went live in {monthWords(month)}.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-[14px]">
                <thead>
                  <tr className="text-left text-[12px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Client</th>
                    <th className="px-3 py-2 text-right font-medium">Posts</th>
                    <th className="px-3 py-2 font-medium">Networks</th>
                    <th className="px-3 py-2 text-right font-medium">Views</th>
                    <th className="px-3 py-2 text-right font-medium">Likes</th>
                    <th className="px-3 py-2 text-right font-medium">Comments</th>
                    <th className="px-4 py-2 text-right font-medium">Engagement</th>
                  </tr>
                </thead>
                <tbody>
                  {clients.map(c => {
                    const info = c.clientId ? nameOf.get(c.clientId) : null
                    return (
                      <tr key={c.clientId ?? NO_CLIENT} onClick={() => setClient(c.clientId ?? NO_CLIENT)}
                        className="cursor-pointer border-t border-border hover:bg-muted/60">
                        <td className="px-4 py-2.5">
                          <span className="flex items-center gap-2.5">
                            <Logo src={info?.logo ?? null} name={clientName(c.clientId)} />
                            <span className={cn('font-medium', !c.clientId && 'text-muted-foreground')}>{clientName(c.clientId)}</span>
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{c.posts}</td>
                        <td className="px-3 py-2.5">
                          <span className="flex flex-wrap items-center gap-2">
                            {platformsIn(Object.keys(c.byPlatform).map(platform => ({ platform }))).map(p => (
                              <span key={p} className="inline-flex items-center gap-1 text-[13px] tabular-nums" title={networkName(p)}>
                                <PlatformIcon platform={p} size={14} />{c.byPlatform[p]}
                              </span>
                            ))}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{compact(c.views)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{compact(c.likes)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{compact(c.comments)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{c.engagementRate === null ? '—' : `${c.engagementRate}%`}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* the posts */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2.5 text-[17px] font-semibold">
            {client !== ALL && <Logo src={client === NO_CLIENT ? null : nameOf.get(client)?.logo ?? null} name={client === NO_CLIENT ? NO_CLIENT_NAME : clientName(client)} />}
            {client === ALL ? 'Every post' : client === NO_CLIENT ? NO_CLIENT_NAME : clientName(client)}
            <span className="text-[14px] font-normal text-muted-foreground">· {shown.length}</span>
            {client !== ALL && <button type="button" onClick={() => setClient(ALL)} className="text-[13px] font-medium text-muted-foreground underline">All clients</button>}
          </h2>
          <Select value={sort} onValueChange={v => setSort(v as Sort)}>
            <SelectTrigger className="h-9 w-48 rounded-full bg-surface" aria-label="Sort"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-popover">
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="views">Most views</SelectItem>
              <SelectItem value="engagement">Most interactions</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {loading && !data ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {[0, 1, 2, 3, 4, 5, 6, 7].map(i => <Skeleton key={i} className="h-80 w-full rounded-inner" />)}
          </div>
        ) : shown.length === 0 ? (
          <p className="rounded-inner border border-dashed border-border p-10 text-center text-[14px] text-muted-foreground">
            No posts match in {monthWords(month)}.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {shown.map(p => <PostTile key={p.id} post={p} client={client === ALL ? clientName(p.clientId) : null} />)}
          </div>
        )}
        {data && !data.complete && (
          <p className="text-[13px] text-muted-foreground">Zernio did not send the whole month in one go — some posts may be missing. Press Refresh to try again.</p>
        )}
      </section>
      </>}
    </div>
  )
}

function Pill({ on, onClick, children, label }: { on: boolean; onClick: () => void; children: React.ReactNode; label?: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} aria-label={label} title={label}
      className={cn('inline-flex h-8 min-w-8 items-center justify-center rounded-full px-3 text-[13px] font-medium transition-colors',
        on ? 'bg-foreground text-background' : 'hover:bg-muted')}>
      {children}
    </button>
  )
}

function Stat({ label, value, hint }: { label: string; value: string | null; hint?: string }) {
  return (
    <div className="rounded-inner border border-border bg-surface p-4" title={hint}>
      <p className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      {value === null ? <Skeleton className="mt-2 h-8 w-16" /> : <p className="mt-1 text-[28px] font-semibold leading-tight tabular-nums">{value}</p>}
    </div>
  )
}

function Logo({ src, name }: { src: string | null; name: string }) {
  const [broken, setBroken] = useState(false)
  if (!src || broken) {
    return <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-[12px] font-semibold">{name.charAt(0).toUpperCase()}</span>
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" onError={() => setBroken(true)} className="h-7 w-7 shrink-0 rounded-full object-cover" />
}

function PostTile({ post, client }: { post: TrackerPost; client: string | null }) {
  const [broken, setBroken] = useState(false)
  const day = new Date(post.publishedAt)
  const body = (
    <>
      <div className="relative aspect-[4/5] w-full overflow-hidden rounded-t-inner bg-muted">
        {post.thumbnail && !broken ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={post.thumbnail} alt="" loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center p-5 text-center text-[13px] text-muted-foreground">
            {post.caption ? post.caption.slice(0, 140) : 'No preview'}
          </div>
        )}
        <span className="absolute left-2 top-2 flex items-center gap-1.5 rounded-full bg-surface/95 px-2 py-1 text-[12px] font-semibold shadow-sm">
          <PlatformIcon platform={post.platform} size={14} />{post.kind}
        </span>
        {post.via === 'native' && (
          <span className="absolute right-2 top-2 rounded-full bg-ink/80 px-2 py-1 text-[11px] font-semibold text-cream" title="Posted by the client on the network, not through Zernio">
            By the client
          </span>
        )}
        {post.url && (
          <span className="absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-full bg-surface/95 opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
            <ExternalLink className="h-4 w-4" />
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-center justify-between gap-2 text-[12px] text-muted-foreground">
          <span className="truncate">{client ? <span className="font-semibold text-foreground">{client}</span> : post.account ? `@${post.account}` : networkName(post.platform)}</span>
          <span className="shrink-0">{DAY.format(day)} · {TIME.format(day)}</span>
        </div>
        {post.caption && <p className="line-clamp-2 text-[13px] leading-snug">{post.caption}</p>}
        <div className="mt-auto grid grid-cols-4 gap-1 border-t border-border pt-2 text-[12px] tabular-nums">
          <Metric icon={Eye} value={post.views} label="Views" />
          <Metric icon={Heart} value={post.likes} label="Likes" />
          <Metric icon={MessageCircle} value={post.comments} label="Comments" />
          <Metric icon={post.saves > post.shares ? Bookmark : Share2} value={post.shares + post.saves} label="Shares and saves" />
        </div>
      </div>
    </>
  )
  const box = 'group flex flex-col overflow-hidden rounded-inner border border-border bg-surface transition-shadow hover:shadow-[0_2px_12px_rgba(11,11,11,0.08)]'
  return post.url
    ? <a href={post.url} target="_blank" rel="noopener noreferrer" className={box}>{body}</a>
    : <div className={box}>{body}</div>
}

function Metric({ icon: Icon, value, label }: { icon: typeof Eye; value: number; label: string }) {
  return (
    <span className="flex items-center gap-1" title={`${value.toLocaleString('en-AU')} ${label.toLowerCase()}`}>
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />{compact(value)}
    </span>
  )
}
