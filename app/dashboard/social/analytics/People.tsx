'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ArrowDown, ArrowUp, BadgeCheck, Download, Lock, Search, Users } from 'lucide-react'
import { LoadFailed } from '../../NotSetUp'
import Chip from '../../ui/Chip'
import { shiftDay, shortDay } from '@/app/lib/followers-core'
import {
  csvFilename, emptyLine, firstDirFor, followedWordsFor, FROM_US_EXPLAINER,
  fromUsWords, peopleCounts, peopleCsv, reachedOutWords, sinceDay, viewPeople,
  type PeopleRow, type PeopleSort, type PeopleState, type Period, type SortDir,
} from '@/app/lib/people-analytics-core'

/**
 * THE PEOPLE BEHIND THE NUMBERS.
 *
 * A view on the Analytics page, not a page of its own — the app has enough
 * pages. One row per person: who they are, what they did on our posts, the day
 * they turned up in the follower list, whether that follow came after
 * something we put out, and whether they have since written to the client.
 *
 * This is the screen an account manager turns around and shows a client, so
 * two rules run through the layout. Every number is a way in: pressing a count
 * filters the table under it. And nothing claims more than the dates support —
 * the "From MD Media" chip says "Likely", and the note under the table says
 * plainly why it cannot say more.
 */

type Payload = {
  state: PeopleState
  client: { id: string; name: string } | null
  today: string
  rows: PeopleRow[]
  post_days: string[]
  as_of: string | null
}

type Focus = 'all' | 'gained' | 'from_us' | 'reached'

const SORTS: { key: PeopleSort; label: string; className: string }[] = [
  { key: 'person', label: 'Person', className: 'w-[26%]' },
  { key: 'did', label: 'What they did', className: 'w-[28%]' },
  { key: 'followed', label: 'Followed', className: 'w-[14%]' },
  { key: 'from_us', label: 'From MD Media', className: 'w-[18%]' },
  { key: 'reached', label: 'Reached out', className: 'w-[14%]' },
]

export default function People({ clientId, clientName }: { clientId: string; clientName: string | null }) {
  const [data, setData] = useState<Payload | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [period, setPeriod] = useState<Period>(30)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<PeopleSort>('followed')
  const [dir, setDir] = useState<SortDir>('desc')
  const [focus, setFocus] = useState<Focus>('all')
  const [open, setOpen] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    setData(null); setFailed(null)
    try {
      const res = await fetch(`/api/social/people?clientId=${encodeURIComponent(clientId)}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load the people')
      setData(json)
    } catch (e) {
      setFailed(e instanceof Error ? e.message : 'unknown')
    }
  }, [clientId])

  useEffect(() => { void load() }, [load])
  useEffect(() => { setFocus('all'); setOpen({}) }, [period, q])

  const today = data?.today ?? ''
  const since = useMemo(() => (today ? sinceDay(today, period) : null), [today, period])

  const counts = useMemo(
    () => peopleCounts(data?.rows ?? [], (data?.post_days ?? []).map(day => ({ day })), since),
    [data, since])

  const rows = useMemo(() => {
    const all = data?.rows ?? []
    const within = (day: string | null) => day !== null && (since === null || day >= since)
    const kept = focus === 'gained' ? all.filter(r => within(r.followed_on))
      : focus === 'from_us' ? all.filter(r => within(r.followed_on) && r.from_us.likely)
      : focus === 'reached' ? all.filter(r => within(r.reached_out_on))
      : all
    return viewPeople(kept, { since, q, sort, dir })
  }, [data, focus, since, q, sort, dir])

  const spark = useMemo(() => {
    if (!today) return []
    const from = since ?? shiftDay(today, -29)
    const days: { day: string; n: number }[] = []
    for (let d = from; d <= today; d = shiftDay(d, 1)) days.push({ day: d, n: 0 })
    const at = new Map(days.map((d, i) => [d.day, i]))
    for (const r of data?.rows ?? []) {
      const i = r.followed_on ? at.get(r.followed_on) : undefined
      if (i !== undefined) days[i].n++
    }
    return days
  }, [data, since, today])

  const press = (key: PeopleSort) => {
    if (key === sort) setDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSort(key); setDir(firstDirFor(key)) }
  }

  const download = () => {
    try {
      const blob = new Blob([peopleCsv(rows)], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = csvFilename(clientName, today)
      a.click()
      URL.revokeObjectURL(url)
      toast.success(`${rows.length} ${rows.length === 1 ? 'person' : 'people'} downloaded`)
    } catch {
      toast.error('That download didn’t start. Try again in a moment.')
    }
  }

  if (failed) {
    return <LoadFailed what="the people behind these numbers" detail={failed} onRetry={() => void load()} />
  }
  if (!data) return <Loading />
  if (data.state !== 'ready') {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 px-6 py-14 text-center">
          <Users className="h-6 w-6 text-muted-foreground" />
          <p className="max-w-xl text-body-15 text-muted-foreground">{emptyLine(data.state, clientName)}</p>
        </CardContent>
      </Card>
    )
  }

  const tile = (key: Focus, value: number, label: string) => (
    <Tile
      value={value}
      label={label}
      active={focus === key}
      onClick={() => setFocus(f => (f === key ? 'all' : key))}
    />
  )

  return (
    <div className="flex flex-col gap-4">
      {/* the four counts, each a way into the table ── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          value={counts.followersGained}
          label="new followers"
          active={focus === 'gained'}
          onClick={() => setFocus(f => (f === 'gained' ? 'all' : 'gained'))}
        >
          <Spark points={spark} />
        </Tile>
        {tile('from_us', counts.interactedFirst, 'of them engaged with a post first')}
        {tile('reached', counts.reachedOut, 'wrote to the client')}
        <Tile value={counts.postsPublished} label="posts went out" href="/dashboard/scheduler/calendar" />
      </div>

      {/* period, search, download ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-inner bg-foreground/[0.06] p-1">
          {([30, 90, null] as Period[]).map(p => (
            <button
              key={String(p)}
              type="button"
              onClick={() => setPeriod(p)}
              className={`min-h-11 rounded-tile px-3.5 py-1.5 text-body-15 transition-colors ${
                period === p ? 'bg-surface font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {p === null ? 'All time' : `${p} days`}
            </button>
          ))}
        </div>
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search a handle or name"
            className="h-11 pl-9"
          />
        </div>
        <Button variant="outline" size="sm" onClick={download} disabled={rows.length === 0} className="ml-auto">
          <Download className="h-3.5 w-3.5" /> Download
        </Button>
      </div>

      {focus !== 'all' && (
        <p className="text-secondary-13 text-muted-foreground">
          Showing only{' '}
          {focus === 'gained' ? 'people who followed in this period'
            : focus === 'from_us' ? 'people who engaged with a post before following'
            : 'people who wrote to the client'}.{' '}
          <button type="button" onClick={() => setFocus('all')}
            className="underline underline-offset-2 hover:text-foreground [@media(pointer:coarse)]:min-h-11">
            Show everyone
          </button>
        </p>
      )}

      {/* the table ── */}
      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
              <Users className="h-6 w-6 text-muted-foreground" />
              <p className="text-body-15 font-medium">Nobody yet</p>
              <p className="max-w-md text-body-15 text-muted-foreground">
                {q.trim() || focus !== 'all'
                  ? 'Nobody here matches that. Try a longer period, or clear the search.'
                  : 'This fills in as posts go out and people follow.'}
              </p>
            </div>
          ) : (
            <>
              {/* wide: a real table ── */}
              <div className="hidden md:block">
                <table className="w-full table-fixed border-collapse">
                  <thead>
                    <tr className="border-b border-border">
                      {SORTS.map(c => (
                        <th key={c.key} className={`${c.className} px-5 py-3 text-left align-bottom`}>
                          <button
                            type="button"
                            onClick={() => press(c.key)}
                            className="inline-flex items-center gap-1 text-secondary-13 font-medium text-muted-foreground transition-colors hover:text-foreground [@media(pointer:coarse)]:min-h-11"
                          >
                            {c.label}
                            {sort === c.key && (dir === 'asc'
                              ? <ArrowUp className="h-3 w-3" />
                              : <ArrowDown className="h-3 w-3" />)}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.key} className="border-b border-border transition-colors last:border-0 hover:bg-foreground/[0.03]">
                        <td className="px-5 py-3 align-middle"><Person row={r} /></td>
                        <td className="px-5 py-3 align-middle">
                          <Did row={r} open={!!open[r.key]} onToggle={() => setOpen(o => ({ ...o, [r.key]: !o[r.key] }))} />
                        </td>
                        <td className="px-5 py-3 align-middle text-body-15">{followedWordsFor(r)}</td>
                        <td className="px-5 py-3 align-middle">
                          {r.from_us.likely && <Chip tone="green">{fromUsWords(r.from_us)}</Chip>}
                        </td>
                        <td className="px-5 py-3 align-middle">
                          {r.reached_out_on
                            ? <Link href={r.inbox_href} className="text-body-15 underline-offset-4 hover:underline">{reachedOutWords(r)}</Link>
                            : <span className="text-body-15 text-muted-foreground">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* narrow: one card a person ── */}
              <ul className="flex flex-col md:hidden">
                {rows.map(r => (
                  <li key={r.key} className="flex flex-col gap-2 border-b border-border p-4 last:border-0">
                    <Person row={r} />
                    <Did row={r} open={!!open[r.key]} onToggle={() => setOpen(o => ({ ...o, [r.key]: !o[r.key] }))} />
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Chip>{followedWordsFor(r) === '—' ? 'Not following' : `Followed ${followedWordsFor(r)}`}</Chip>
                      {r.from_us.likely && <Chip tone="green">{fromUsWords(r.from_us)}</Chip>}
                      {r.reached_out_on && (
                        <Link href={r.inbox_href} className="inline-flex min-h-11 items-center">
                          <Chip tone="blue">{reachedOutWords(r)}</Chip>
                        </Link>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>

      <p className="max-w-3xl text-secondary-13 text-muted-foreground">
        <span className="font-medium text-foreground">From MD Media.</span> {FROM_US_EXPLAINER}
        {data.as_of && ` The follower list was last read on ${shortDay(data.as_of)}.`}
      </p>
    </div>
  )
}

/* ── the hero counts ───────────────────────────────────────────────────── */

/**
 * One count. Pressing it filters the table under it — a number nobody can act
 * on is a number nobody trusts. All four are the same height whether or not
 * they carry a sparkline, so the figures sit on one line across the row.
 */
function Tile({ value, label, active, onClick, href, children }: {
  value: number
  label: string
  active?: boolean
  onClick?: () => void
  href?: string
  children?: React.ReactNode
}) {
  const cls = `flex min-h-[116px] flex-col items-start gap-0.5 rounded-card border px-5 py-4 text-left transition-colors ${
    active ? 'border-accent-blue/40 bg-tint-blue' : 'border-border bg-card hover:border-foreground/25'
  }`
  const body = (
    <>
      <span className="text-stat-30 tabular-nums tracking-[-0.02em]">{value.toLocaleString()}</span>
      <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
      <span className="mt-auto block h-8 w-full pt-1">{children}</span>
    </>
  )
  if (href) return <Link href={href} className={cls}>{body}</Link>
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={cls}>{body}</button>
  )
}

/* ── the cells ─────────────────────────────────────────────────────────── */

function Person({ row }: { row: PeopleRow }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar src={row.profile_pic} name={row.full_name ?? row.username} />
      <div className="min-w-0">
        <a
          href={row.profile_href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 truncate text-body-15 font-medium underline-offset-4 hover:underline"
        >
          @{row.username}
          {row.is_verified && <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-accent-blue" aria-label="Verified" />}
          {row.is_private && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Private account" />}
        </a>
        {row.full_name && <p className="truncate text-secondary-13 text-muted-foreground">{row.full_name}</p>}
      </div>
    </div>
  )
}

const SHOWN = 2

function Did({ row, open, onToggle }: { row: PeopleRow; open: boolean; onToggle: () => void }) {
  if (row.actions.length === 0) return <span className="text-body-15 text-muted-foreground">—</span>
  const shown = open ? row.actions : row.actions.slice(0, SHOWN)
  const rest = row.actions.length - shown.length
  return (
    <div className="flex flex-col gap-0.5">
      {shown.map((a, i) => {
        // the same words as `actionWords`, split so the post's name can be
        // the link — never the raw address
        const lead = a.kind === 'liked' ? 'liked ' : `${a.kind} on `
        return (
          <p key={`${a.item_id ?? 'post'}-${i}`} className="truncate text-body-15">
            {lead}
            {a.href
              ? <Link href={a.href} className="font-medium text-accent-blue-deep underline-offset-4 hover:underline dark:text-accent-blue">{a.title}</Link>
              : <span className="font-medium">{a.title}</span>}
          </p>
        )
      })}
      {(rest > 0 || open) && (
        <button
          type="button"
          onClick={onToggle}
          className="w-fit text-secondary-13 text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground [@media(pointer:coarse)]:min-h-11"
        >
          {open ? 'Show less' : `+${rest} more`}
        </button>
      )}
    </div>
  )
}

function Avatar({ src, name }: { src: string | null; name: string }) {
  const [broken, setBroken] = useState(false)
  const initials = name.replace(/^@/, '').slice(0, 2).toUpperCase()
  if (!src || broken) {
    return (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground/[0.08] text-chip-12 text-muted-foreground">
        {initials}
      </span>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      onError={() => setBroken(true)}
      className="h-9 w-9 shrink-0 rounded-full bg-foreground/[0.06] object-cover"
    />
  )
}

/**
 * New followers per day across the period — one series, so no legend and no
 * axis: the number above it is the figure, and this only says whether it
 * arrived steadily or in one afternoon. The day and its count are in the
 * hover title, which is the whole interaction a sparkline needs.
 */
function Spark({ points }: { points: { day: string; n: number }[] }) {
  if (points.length < 2) return null
  const max = Math.max(1, ...points.map(p => p.n))
  const W = 100
  const H = 28
  const step = W / (points.length - 1)
  const y = (n: number) => H - 2 - (n / max) * (H - 6)
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(2)},${y(p.n).toFixed(2)}`).join(' ')
  const area = `${line} L${W},${H} L0,${H} Z`
  const total = points.reduce((s, p) => s + p.n, 0)
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${total} new followers over ${points.length} days`}
      className="h-7 w-full text-accent-blue"
    >
      <title>{`${total} new followers, ${shortDay(points[0].day)} – ${shortDay(points[points.length - 1].day)}`}</title>
      <path d={area} fill="currentColor" opacity={0.12} />
      <path d={line} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
        vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function Loading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-[104px] rounded-card" />)}
      </div>
      <Skeleton className="h-11 w-full max-w-md rounded-inner" />
      <Card>
        <CardContent className="flex flex-col p-0">
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} className="flex items-center gap-3 border-b border-border px-5 py-3.5 last:border-0">
              <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
              <Skeleton className="h-4 w-40" />
              <Skeleton className="ml-auto hidden h-4 w-56 md:block" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
