'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  ChevronRight, HandHelping, Inbox, Users, AlertTriangle, ArrowRight, UserPlus,
} from 'lucide-react'
import {
  EMPTY_THROUGHPUT, sinceLabel, sortRows, splitByTurn, statusWordOf, throughputPeak,
  type HeldItem, type SortKey, type TeamActivityRow, type Throughput,
} from '../../../lib/team-activity-core'
import type { Role } from '../../../lib/identity-core'

type Payload = {
  rows: TeamActivityRow[]
  viewer: { id: string; role: Role; timezone: string; isAdmin: boolean }
  week: { start: string; end: string; tz: string }
  unassigned: { total: number; items: HeldItem[] }
  clients: { id: string; name: string }[]
}

const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Super admin',
  account_manager: 'Account manager',
  editor: 'Editor',
  scheduler: 'Scheduler',
}

const ROLE_STYLE: Record<string, string> = {
  super_admin:     'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900',
  account_manager: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900',
  editor:          'bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700',
  scheduler:       'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900',
}

const initials = (name: string, email: string) =>
  (name.trim() || email).split(/[\s@.]+/).filter(Boolean).slice(0, 2)
    .map(p => p[0]?.toUpperCase()).join('')

/** A due date is a calendar day, not an instant — no zone conversion belongs
 *  here, or a date typed as the 30th starts rendering as the 29th. */
function dueLabel(due: string | null): string {
  if (!due) return 'no date'
  const [y, m, d] = due.split('-').map(Number)
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1))
    .toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

const THROUGHPUT_BARS: { key: keyof Throughput; label: string; tone: string }[] = [
  { key: 'versions',  label: 'versions added',      tone: 'bg-zinc-400 dark:bg-zinc-500' },
  { key: 'submitted', label: 'submitted for review', tone: 'bg-blue-500' },
  { key: 'approved',  label: 'approved',            tone: 'bg-emerald-500' },
  { key: 'scheduled', label: 'scheduled',           tone: 'bg-amber-500' },
  { key: 'posted',    label: 'posted',              tone: 'bg-violet-500' },
]

/** Five bars, one per kind of move. Deliberately unlabelled at this size: the
 *  shape is the signal ("nothing all week" reads instantly), and the numbers
 *  are on the tooltip for anyone who wants them. */
function ThroughputBars({ t }: { t: Throughput }) {
  const peak = throughputPeak(t)
  const total = THROUGHPUT_BARS.reduce((n, b) => n + t[b.key], 0)
  const title = total === 0
    ? 'Nothing moved this week'
    : THROUGHPUT_BARS.filter(b => t[b.key] > 0).map(b => `${t[b.key]} ${b.label}`).join(' · ')
  return (
    <span className="flex h-6 items-end gap-[3px]" title={title} aria-label={title}>
      {THROUGHPUT_BARS.map(b => (
        <span key={b.key} className="flex h-full w-1.5 items-end">
          <span
            className={`w-full rounded-sm ${t[b.key] > 0 ? b.tone : 'bg-zinc-200 dark:bg-zinc-800'}`}
            style={{ height: t[b.key] > 0 ? `${Math.max(18, (t[b.key] / peak) * 100)}%` : '3px' }}
          />
        </span>
      ))}
    </span>
  )
}

/** Fourteen days of "was anyone here". */
function Sparkline({ days }: { days: { day: string; count: number }[] }) {
  const peak = Math.max(1, ...days.map(d => d.count))
  return (
    <span className="flex h-5 items-end gap-px" aria-hidden>
      {days.map(d => (
        <span
          key={d.day}
          title={`${d.day} · ${d.count}`}
          className={`w-[3px] rounded-sm ${d.count > 0 ? 'bg-zinc-400 dark:bg-zinc-500' : 'bg-zinc-200 dark:bg-zinc-800'}`}
          style={{ height: d.count > 0 ? `${Math.max(20, (d.count / peak) * 100)}%` : '2px' }}
        />
      ))}
    </span>
  )
}

function HoldingSummary({ row }: { row: TeamActivityRow }) {
  if (row.holding.total === 0 && row.holding.shoots === 0 && row.holding.comments === 0) {
    return <span className="text-sm text-zinc-400 dark:text-zinc-500">Nothing — free</span>
  }
  const parts: string[] = []
  if (row.holding.items > 0) parts.push(`${row.holding.items} owned`)
  if (row.holding.scheduling > 0) parts.push(`${row.holding.scheduling} to post`)
  if (row.holding.shoots > 0) parts.push(`${row.holding.shoots} shoot${row.holding.shoots === 1 ? '' : 's'}`)
  if (row.holding.comments > 0) parts.push(`${row.holding.comments} tagged`)
  return (
    <span className="flex flex-col">
      <span className="text-sm tabular-nums">{parts.join(' · ')}</span>
      {row.holding.by_status.length > 0 && (
        <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">
          {row.holding.by_status.slice(0, 3).map(g => `${g.word} ${g.count}`).join(' · ')}
        </span>
      )}
    </span>
  )
}

export default function TeamActivityPage() {
  const [data, setData] = useState<Payload | null>(null)
  const [role, setRole] = useState('all')
  const [client, setClient] = useState('all')
  const [sort, setSort] = useState<SortKey>('overdue')
  const [open, setOpen] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams()
      if (role !== 'all') qs.set('role', role)
      if (client !== 'all') qs.set('client', client)
      const res = await fetch(`/api/team/activity/workload?${qs}`)
      const json = await res.json()
      if (res.status === 403) { setForbidden(true); setData(null); return }
      if (!res.ok) throw new Error(json.error ?? 'Could not load the team')
      setForbidden(false)
      setData(json)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load the team')
      setData(null)
    }
  }, [role, client])

  useEffect(() => { load() }, [load])

  const now = useMemo(() => new Date(), [data])
  const rows = useMemo(() => sortRows(data?.rows ?? [], sort), [data, sort])
  const canReassign = data?.viewer.role === 'account_manager' || data?.viewer.role === 'super_admin'
  const totalOverdue = rows.reduce((n, r) => n + r.due.overdue, 0)

  if (forbidden) {
    return (
      <Card className="border-dashed shadow-none">
        <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
          <Users className="h-6 w-6 text-zinc-300 dark:text-zinc-600" />
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            This page shows the whole team&rsquo;s workload — ask a super admin to open it for you.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Team activity</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Everything assigned, and who is holding it. Throughput is this week
            {data ? ` (${dueLabel(data.week.start)} – ${dueLabel(data.week.end)}, Melbourne)` : ''}.
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger className="h-9 w-40 bg-white dark:bg-zinc-900" aria-label="Filter by role">
              <SelectValue placeholder="All roles" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All roles</SelectItem>
              {Object.entries(ROLE_LABEL).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {(data?.clients.length ?? 0) > 0 && (
            <Select value={client} onValueChange={setClient}>
              <SelectTrigger className="h-9 w-48 bg-white dark:bg-zinc-900" aria-label="Filter by client">
                <SelectValue placeholder="All clients" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All clients</SelectItem>
                {data?.clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Tabs value={sort} onValueChange={v => v && setSort(v as SortKey)}>
            <TabsList>
              <TabsTrigger value="overdue">Overdue</TabsTrigger>
              <TabsTrigger value="holding">Holding</TabsTrigger>
              <TabsTrigger value="name">Name</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      {data && data.unassigned.total > 0 && (
        <UnassignedPool pool={data.unassigned} />
      )}

      {data === null ? (
        <Card><CardContent className="flex flex-col gap-3 p-6">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </CardContent></Card>
      ) : rows.length === 0 ? (
        <Card className="border-dashed shadow-none">
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
            <Inbox className="h-6 w-6 text-zinc-300 dark:text-zinc-600" />
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Nobody is holding work on your clients right now.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* ── Desktop: one table, sortable, rows expand in place ── */}
          <Card className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[26%]">Person</TableHead>
                  <TableHead>Holding</TableHead>
                  <TableHead className="w-24 text-right">Due this week</TableHead>
                  <TableHead className="w-20 text-right">Overdue</TableHead>
                  <TableHead className="w-28">This week</TableHead>
                  <TableHead className="w-28 text-right">Last active</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(r => (
                  <>
                    <TableRow
                      key={r.id}
                      onClick={() => setOpen(o => (o === r.id ? null : r.id))}
                      aria-expanded={open === r.id}
                      className="cursor-pointer"
                    >
                      <TableCell>
                        <span className="flex items-center gap-2.5">
                          <ChevronRight className={`h-4 w-4 shrink-0 text-zinc-400 transition-transform ${open === r.id ? 'rotate-90' : ''}`} />
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-zinc-100 font-mono text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                            {initials(r.name, r.email)}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">{r.name || r.email}</span>
                            <Badge variant="outline" className={`mt-0.5 font-normal ${ROLE_STYLE[r.role] ?? ''}`}>
                              {ROLE_LABEL[r.role] ?? r.role}
                            </Badge>
                          </span>
                        </span>
                      </TableCell>
                      <TableCell><HoldingSummary row={r} /></TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{r.due.this_week}</TableCell>
                      <TableCell className={`text-right font-mono tabular-nums ${r.due.overdue > 0 ? 'font-semibold text-red-600 dark:text-red-400' : 'text-zinc-400'}`}>
                        {r.due.overdue}
                      </TableCell>
                      <TableCell><ThroughputBars t={r.throughput ?? EMPTY_THROUGHPUT} /></TableCell>
                      <TableCell className="text-right">
                        <span className="flex flex-col items-end gap-1">
                          <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                            {sinceLabel(r.last_active, now, data.viewer.timezone)}
                          </span>
                          <Sparkline days={r.activity} />
                        </span>
                      </TableCell>
                    </TableRow>
                    {open === r.id && (
                      <TableRow key={`${r.id}-panel`} className="hover:bg-transparent">
                        <TableCell colSpan={6} className="bg-zinc-50/70 p-0 dark:bg-zinc-900/40">
                          <PersonPanel person={r} people={rows} canReassign={canReassign} onChanged={load} />
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
              </TableBody>
            </Table>
          </Card>

          {/* ── Mobile: the same rows as cards ── */}
          <div className="flex flex-col gap-2 md:hidden">
            {rows.map(r => (
              <Card key={r.id} className={r.due.overdue > 0 ? 'border-red-200 dark:border-red-900/60' : undefined}>
                <button
                  type="button"
                  onClick={() => setOpen(o => (o === r.id ? null : r.id))}
                  aria-expanded={open === r.id}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left"
                >
                  <ChevronRight className={`h-4 w-4 shrink-0 text-zinc-400 transition-transform ${open === r.id ? 'rotate-90' : ''}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{r.name || r.email}</span>
                    <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                      {ROLE_LABEL[r.role] ?? r.role} · {sinceLabel(r.last_active, now, data.viewer.timezone)}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className={`block font-mono text-lg tabular-nums ${r.due.overdue > 0 ? 'text-red-600 dark:text-red-400' : 'text-zinc-900 dark:text-zinc-100'}`}>
                      {r.due.overdue}
                    </span>
                    <span className="block font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400">overdue</span>
                  </span>
                </button>
                <div className="flex items-center gap-3 border-t border-zinc-100 px-4 py-2 dark:border-zinc-800">
                  <HoldingSummary row={r} />
                  <span className="ml-auto shrink-0"><ThroughputBars t={r.throughput ?? EMPTY_THROUGHPUT} /></span>
                </div>
                {open === r.id && (
                  <PersonPanel person={r} people={rows} canReassign={canReassign} onChanged={load} />
                )}
              </Card>
            ))}
          </div>
        </>
      )}

      {totalOverdue > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
          <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
          {totalOverdue} piece{totalOverdue === 1 ? '' : 's'} past its date across the team. A date is
          read on the client&rsquo;s own calendar, so &ldquo;today&rdquo; is not the same day for every row.
        </p>
      )}
    </div>
  )
}

/** What nobody has picked up — the other half of "who is free". */
function UnassignedPool({ pool }: { pool: { total: number; items: HeldItem[] } }) {
  const [show, setShow] = useState(false)
  return (
    <Card className="border-amber-200 bg-amber-50/50 dark:border-amber-900/60 dark:bg-amber-950/20">
      <CardHeader className="flex-row items-center gap-2 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <HandHelping className="h-4 w-4 text-amber-600 dark:text-amber-500" />
          Unassigned pool
          <span className="font-mono tabular-nums text-amber-700 dark:text-amber-400">{pool.total}</span>
        </CardTitle>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setShow(s => !s)}>
          {show ? 'Hide' : 'Show'}
        </Button>
        <Button variant="outline" size="sm" asChild>
          <Link href="/dashboard/editor">Open board <ArrowRight className="h-3.5 w-3.5" /></Link>
        </Button>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          Work nobody holds — waiting for an editor to claim it, or for a scheduler to take an
          approved piece. Shoot briefs are not in here; an account manager writes those.
        </p>
        {show && (
          <ul className="mt-3 flex flex-col">
            {pool.items.map(i => <ItemLine key={i.id} item={i} />)}
            {pool.total > pool.items.length && (
              <li className="pt-2 text-xs text-zinc-500 dark:text-zinc-400">
                +{pool.total - pool.items.length} more on the board
              </li>
            )}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

/** One person, opened: what is theirs to move, and what they are waiting on. */
function PersonPanel({ person, people, canReassign, onChanged }: {
  person: TeamActivityRow
  people: TeamActivityRow[]
  canReassign: boolean
  onChanged: () => void
}) {
  const { mine, waiting } = useMemo(
    () => splitByTurn(person.items, { id: person.id, role: person.role }),
    [person],
  )

  if (person.items.length === 0) {
    return (
      <div className="px-4 py-6 text-sm text-zinc-500 dark:text-zinc-400">
        {person.name || person.email} is holding nothing right now.
        {person.holding.shoots > 0 && ` (${person.holding.shoots} shoot${person.holding.shoots === 1 ? '' : 's'} to plan.)`}
      </div>
    )
  }

  return (
    <div className="grid gap-6 px-4 py-4 lg:grid-cols-2">
      <ItemGroup
        title="Your turn" hint="waiting on them"
        items={mine} people={people} canReassign={canReassign} onChanged={onChanged}
        empty="Nothing is waiting on them."
      />
      <ItemGroup
        title="Waiting on others" hint="handed on, not finished"
        items={waiting} people={people} canReassign={canReassign} onChanged={onChanged}
        empty="Nothing handed on."
      />
    </div>
  )
}

function ItemGroup({ title, hint, items, people, canReassign, onChanged, empty }: {
  title: string
  hint: string
  items: HeldItem[]
  people: TeamActivityRow[]
  canReassign: boolean
  onChanged: () => void
  empty: string
}) {
  return (
    <div>
      <p className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-zinc-400">
        {title} <span className="normal-case tracking-normal">· {hint}</span>
      </p>
      {items.length === 0
        ? <p className="py-2 text-sm text-zinc-400 dark:text-zinc-500">{empty}</p>
        : (
          <ul className="flex flex-col">
            {items.map(i => (
              <ItemLine key={i.id} item={i}
                reassign={canReassign ? { people, onChanged } : undefined} />
            ))}
          </ul>
        )}
    </div>
  )
}

function ItemLine({ item, reassign }: {
  item: HeldItem
  reassign?: { people: TeamActivityRow[]; onChanged: () => void }
}) {
  const [saving, setSaving] = useState(false)
  const overdue = !!item.due_date && item.due_date < new Date().toISOString().slice(0, 10)

  const handOver = async (ownerId: string) => {
    setSaving(true)
    try {
      const res = await fetch(`/api/production/items/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner_id: ownerId }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Could not reassign')
      toast.success('Reassigned — they have been told')
      reassign?.onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not reassign')
    } finally {
      setSaving(false)
    }
  }

  return (
    <li className="flex items-center gap-2.5 border-b border-zinc-100 py-1.5 last:border-b-0 dark:border-zinc-800/60">
      <Link
        href={`/dashboard/production/${item.id}`}
        className="min-w-0 flex-1 truncate text-sm hover:underline"
      >
        {item.title}
      </Link>
      <Badge variant="outline" className="hidden shrink-0 font-normal text-zinc-600 sm:inline-flex dark:text-zinc-400">
        {statusWordOf(item)}
      </Badge>
      {item.client_name && (
        <span className="hidden shrink-0 truncate text-xs text-zinc-500 lg:block dark:text-zinc-400">
          {item.client_name}
        </span>
      )}
      <span className={`shrink-0 font-mono text-xs tabular-nums ${overdue ? 'text-red-600 dark:text-red-400' : 'text-zinc-400'}`}>
        {dueLabel(item.due_date)}
      </span>
      {reassign && (
        <Select disabled={saving} onValueChange={handOver}>
          <SelectTrigger
            aria-label={`Reassign "${item.title}"`}
            className="h-7 w-7 shrink-0 justify-center border-none bg-transparent p-0 shadow-none [&>svg:last-child]:hidden"
          >
            <UserPlus className="h-3.5 w-3.5 text-zinc-400" />
          </SelectTrigger>
          <SelectContent>
            {reassign.people.map(p => (
              <SelectItem key={p.id} value={p.id}>{p.name || p.email}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </li>
  )
}
