'use client'

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ArrowLeft, BadgeCheck, ExternalLink, Lock, RefreshCw, Search, Users } from 'lucide-react'
import PageTitle from '../../../ui/PageTitle'
import TintCard from '../../../ui/TintCard'
import Stat from '../../../ui/Stat'
import Chip from '../../../ui/Chip'
import { followedWords, leftWords, shortDay } from '../../../../lib/followers-core'
import { friendlyError } from '@/app/lib/support-core'

/**
 * WHO FOLLOWS this account — the list, who joined, who left.
 *
 * Three piles. NEW is this week's joiners by day; LEFT is who a full read
 * found missing this week; ALL is everybody, newest first, searchable. Each
 * person is a face, a name, a handle that opens their profile, and one plain
 * line: "Followed on 5 Sep". A join date we cannot know (they were already
 * there when watching began) is shown as "—", never guessed.
 *
 * Nothing on this page names the service the list comes from, and nothing
 * on it shows money — the owner's rules, pinned by tests.
 */

type Person = {
  username: string
  full_name: string | null
  profile_pic: string | null
  is_private: boolean
  is_verified: boolean
  first_seen_at: string | null
  gone_at: string | null
  from_post: { item_id: string; chip: string } | null
}

type Payload = {
  enabled: boolean
  state: 'off' | 'not_instagram' | 'private' | 'waiting' | 'ready'
  account: { id: string; username: string | null; platform: string; client_id: string }
  client: { id: string; name: string } | null
  mayRefresh: boolean
  today?: string
  count?: number | null
  growth?: number | null
  following?: number
  lastLook?: { words: string; running: boolean; day: string | null }
  refresh?: { ok: true } | { ok: false; reason: string; retryAt: string }
  piles?: {
    new: { day: string; rows: Person[] }[]
    left: Person[]
    all: Person[]
    all_total: number
  }
}

type Pile = 'new' | 'left' | 'all'

export default function FollowersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pile, setPile] = useState<Pile>('new')
  const [q, setQ] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (search = '') => {
    try {
      const res = await fetch(`/api/social/accounts/${id}/followers?q=${encodeURIComponent(search)}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load the followers')
      setData(json)
      setError(null)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not load the followers'
      setError(friendlyError(msg, 'Followers'))
    }
  }, [id])

  useEffect(() => { void load() }, [load])

  // search is answered by the server so the All pile never has to ship whole
  useEffect(() => {
    if (pile !== 'all') return
    const t = setTimeout(() => { void load(q) }, 250)
    return () => clearTimeout(t)
  }, [q, pile, load])

  // a look under way finishes in the background — keep asking while it runs
  useEffect(() => {
    if (!data?.lastLook?.running) return
    const t = setInterval(() => { void load(q) }, 15_000)
    return () => clearInterval(t)
  }, [data?.lastLook?.running, load, q])

  const refresh = async () => {
    setRefreshing(true)
    try {
      const res = await fetch(`/api/social/accounts/${id}/followers/refresh`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not start a fresh look')
      toast.success('Looking now. The newest followers appear here in a minute or two.')
      setTimeout(() => { void load(q) }, 4000)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not start a fresh look')
    } finally {
      setRefreshing(false)
    }
  }

  const title = data?.account.username ? `@${data.account.username}` : 'Followers'

  if (error) {
    return (
      <div className="flex flex-col gap-4">
        <Back id={id} />
        <PageTitle title="Followers" summary={SUMMARY} />
        <Card><CardContent className="p-6 text-body-15 text-accent-red">{error}</CardContent></Card>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="flex flex-col gap-4">
        <Back id={id} />
        <PageTitle title="Followers" summary={SUMMARY} />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const notice =
    data.state === 'off' ? 'Not switched on.'
    : data.state === 'not_instagram' ? 'Only Instagram accounts have a follower list here.'
    : data.state === 'private' ? 'This account is private, so its followers can’t be listed.'
    : null

  const piles = data.piles
  const newCount = piles?.new.reduce((n, d) => n + d.rows.length, 0) ?? 0

  return (
    <div className="flex flex-col gap-4">
      <Back id={id} />
      <PageTitle
        title={`${title} · Followers`}
        summary={SUMMARY}
        actions={data.mayRefresh && data.enabled && data.state !== 'not_instagram' ? (
          <Button onClick={() => void refresh()} disabled={refreshing || data.refresh?.ok === false || data.lastLook?.running}>
            <RefreshCw className={`h-4 w-4 ${refreshing || data.lastLook?.running ? 'animate-spin' : ''}`} />
            {data.lastLook?.running ? 'Looking now…' : 'Refresh now'}
          </Button>
        ) : undefined}
      />

      {notice ? (
        <Card>
          <CardContent className="flex items-start gap-3 p-6 text-body-15">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <span>{notice}</span>
          </CardContent>
        </Card>
      ) : (
        <>
          <TintCard tone="paper" title="Right now">
            <div className="flex flex-wrap items-end gap-7">
              <Stat value={data.count === null || data.count === undefined ? '—' : data.count.toLocaleString()} label="followers" />
              {typeof data.growth === 'number' && data.growth !== 0 && (
                <Stat value={`${data.growth > 0 ? '+' : ''}${data.growth.toLocaleString()}`} label="recently" />
              )}
              <Stat value={newCount} label="joined this week" />
              <Stat value={piles?.left.length ?? 0} label="left this week" />
            </div>
            <p className="text-secondary-13 text-muted-foreground">{data.lastLook?.words}</p>
            {data.refresh && !data.refresh.ok && data.mayRefresh && !data.lastLook?.running && (
              <p className="text-secondary-13 text-muted-foreground">
                Refresh is available again after {new Date(data.refresh.retryAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}.
              </p>
            )}
          </TintCard>

          {/* ── the piles ───────────────────────────────────────────── */}
          <div role="tablist" aria-label="Followers" className="flex flex-wrap gap-2">
            {([
              ['new', `New this week`, newCount],
              ['left', `Left this week`, piles?.left.length ?? 0],
              ['all', `All`, data.following ?? 0],
            ] as const).map(([key, label, n]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={pile === key}
                onClick={() => setPile(key)}
                className={`inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-body-15 transition-colors ${
                  pile === key ? 'bg-foreground text-background' : 'border border-border hover:bg-foreground/[0.04]'
                }`}
              >
                {label}
                <span className={`font-mono text-chip-12 tabular-nums ${pile === key ? 'opacity-70' : 'text-muted-foreground'}`}>{n.toLocaleString()}</span>
              </button>
            ))}
          </div>

          {pile === 'new' && (
            piles && piles.new.length > 0 ? (
              <div className="flex flex-col gap-4">
                {piles.new.map(d => (
                  <Card key={d.day}>
                    <CardContent className="p-4">
                      <h3 className="mb-3 text-card-title">
                        {d.day === data.today ? 'Today' : shortDay(d.day)}{' '}
                        <span className="font-normal text-muted-foreground">({d.rows.length})</span>
                      </h3>
                      <People rows={d.rows} line={followedWords} />
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Empty>
                {data.state === 'waiting'
                  ? 'Not looked at yet — the first look happens tomorrow morning, and every follower found then is the starting list.'
                  : 'Nobody new this week.'}
              </Empty>
            )
          )}

          {pile === 'left' && (
            piles && piles.left.length > 0 ? (
              <Card><CardContent className="p-4"><People rows={piles.left} line={leftWords} /></CardContent></Card>
            ) : (
              <Empty>Nobody has left this week. Who left is worked out when the whole list is read — once a month, unless this client chose weekly.</Empty>
            )
          )}

          {pile === 'all' && (
            <div className="flex flex-col gap-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={q}
                  onChange={e => setQ(e.target.value)}
                  placeholder="Search by name or handle"
                  aria-label="Search followers"
                  className="min-h-11 pl-9"
                />
              </div>
              {piles && piles.all.length > 0 ? (
                <Card>
                  <CardContent className="p-4">
                    <People rows={piles.all} line={followedWords} />
                    {piles.all_total > piles.all.length && (
                      <p className="mt-3 text-secondary-13 text-muted-foreground">
                        Showing the newest {piles.all.length.toLocaleString()} of {piles.all_total.toLocaleString()}. Search to find somebody further down.
                      </p>
                    )}
                  </CardContent>
                </Card>
              ) : (
                <Empty>{q ? 'Nobody matches that.' : 'No followers listed yet.'}</Empty>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

const SUMMARY = 'Who follows this account, who joined this week, and who left. Newest first.'

function Back({ id }: { id: string }) {
  return (
    <Link
      href={`/dashboard/social/${id}`}
      className="inline-flex w-fit min-h-11 items-center gap-1.5 text-secondary-13 text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-3.5 w-3.5" /> Back to the account
    </Link>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3 p-6 text-body-15 text-muted-foreground">
        <Users className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{children}</span>
      </CardContent>
    </Card>
  )
}

/** the list: a face, a name, the handle, one line about when */
function People({ rows, line }: { rows: Person[]; line: (p: Person) => string }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map(p => (
        <li key={p.username} className="flex min-h-11 items-center gap-3 rounded-inner border border-border p-2">
          {p.profile_pic ? (
            // Instagram's CDN; next/image would need host config
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.profile_pic} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" loading="lazy" />
          ) : (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-foreground/[0.06] text-secondary-13 text-muted-foreground">
              {p.username.slice(0, 1).toUpperCase()}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-body-15 font-medium">{p.full_name || p.username}</span>
              {p.is_verified && <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-accent-blue-deep" aria-label="Verified" />}
              {p.is_private && <Chip tone="muted" className="shrink-0">Private</Chip>}
              {p.from_post && (
                <Link href={`/dashboard/production/${p.from_post.item_id}`} className="shrink-0" title="Open the post">
                  <Chip tone="green">{p.from_post.chip}</Chip>
                </Link>
              )}
            </div>
            <p className="truncate font-mono text-secondary-13 text-muted-foreground">@{p.username} · {line(p)}</p>
          </div>
          <a
            href={`https://www.instagram.com/${encodeURIComponent(p.username)}/`}
            target="_blank" rel="noopener noreferrer"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground"
            aria-label={`Open @${p.username} on Instagram`}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </li>
      ))}
    </ul>
  )
}
