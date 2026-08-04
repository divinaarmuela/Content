'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Activity, Settings2, CircleAlert, Inbox } from 'lucide-react'
import TransparencyNotice from './TransparencyNotice'
import AsanaSetup from './AsanaSetup'

type Row = {
  id: string
  name: string
  email: string
  employment_type: 'employee' | 'contractor'
  timezone: string
  linked: boolean
  completed: number
  open: number
  overdue: number
  eventCount: number
  lastActivityAt: string | null
}

type Payload = {
  rows: Row[]
  range: { from: string; to: string; days: number }
  viewer: { id: string; isAdmin: boolean; timezone: string }
  connection: {
    configured: boolean
    trackedProjects: number
    liveWebhooks: number
    lastEventAt: string | null
  } | null
}

const RANGES = [
  { days: 7,  label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
]

/** Relative time, coarse — an exact clock reading implies a precision that
 *  event ingestion (webhook or 15-minute poll) does not actually have. */
function sinceLabel(iso: string | null): string {
  if (!iso) return '—'
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return days < 30 ? `${days}d ago` : new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}

function initials(name: string, email: string): string {
  const source = name.trim() || email
  return source.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase()).join('')
}

export default function ActivityPage() {
  const [data, setData] = useState<Payload | null>(null)
  const [days, setDays] = useState(7)
  const [showSetup, setShowSetup] = useState(false)

  const load = useCallback(async (d: number) => {
    try {
      const res = await fetch(`/api/team/activity?days=${d}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load activity')
      setData(json)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load activity')
      setData(null)
    }
  }, [])

  useEffect(() => { load(days) }, [load, days])

  const isAdmin = data?.viewer.isAdmin ?? false
  const rows = data?.rows ?? []
  const hasAnyData = rows.some(r => r.eventCount > 0 || r.open > 0 || r.completed > 0)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Team Activity</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {isAdmin
              ? 'Task activity across tracked Asana projects.'
              : 'Your task activity across tracked Asana projects.'}
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Tabs value={String(days)} onValueChange={v => v && setDays(Number(v))}>
            <TabsList>
              {RANGES.map(r => (
                <TabsTrigger key={r.days} value={String(r.days)}>{r.label}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          {isAdmin && (
            <Button
              variant={showSetup ? 'secondary' : 'outline'} size="sm"
              onClick={() => setShowSetup(s => !s)}
            >
              <Settings2 className="h-3.5 w-3.5" /> Connection
            </Button>
          )}
        </div>
      </div>

      {/* Ships inside phase 1 by requirement, not as a later addition. */}
      <TransparencyNotice />

      {isAdmin && showSetup && <AsanaSetup />}

      {data === null ? (
        <Card><CardContent className="flex flex-col gap-3 p-6">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </CardContent></Card>
      ) : !hasAnyData ? (
        <Card className="border-dashed shadow-none">
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
            <Inbox className="h-6 w-6 text-zinc-300 dark:text-zinc-600" />
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {data.connection && !data.connection.configured
                ? 'Asana isn’t connected yet.'
                : data.connection && data.connection.trackedProjects === 0
                  ? 'No Asana projects are being tracked yet.'
                  : rows.every(r => !r.linked)
                    ? 'No Asana account is matched to you yet.'
                    : 'Nothing recorded in this period.'}
            </p>
            {isAdmin && !showSetup && (
              <Button variant="outline" size="sm" onClick={() => setShowSetup(true)}>
                Open connection settings
              </Button>
            )}
          </CardContent>
        </Card>
      ) : isAdmin ? (
        <TeamTable rows={rows} />
      ) : (
        <PersonalView row={rows[0]} days={days} />
      )}

      {isAdmin && data?.connection?.configured && (
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
          {data.connection.trackedProjects} project{data.connection.trackedProjects === 1 ? '' : 's'} tracked ·{' '}
          {data.connection.liveWebhooks} with live updates · last event {sinceLabel(data.connection.lastEventAt)}
        </p>
      )}
    </div>
  )
}

/** Admin view: one row per person, sorted by who needs attention first. */
function TeamTable({ rows }: { rows: Row[] }) {
  const sorted = [...rows].sort((a, b) => b.overdue - a.overdue || b.open - a.open)

  return (
    <Card className="overflow-hidden py-0">
      <Table>
        <TableHeader>
          <TableRow className="bg-zinc-50 hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-900">
            <TableHead>Person</TableHead>
            <TableHead className="w-24 text-right">Completed</TableHead>
            <TableHead className="w-24 text-right">Open</TableHead>
            <TableHead className="w-24 text-right">Overdue</TableHead>
            <TableHead className="w-24 text-right">Events</TableHead>
            <TableHead className="w-28">Last activity</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map(r => (
            <TableRow key={r.id}>
              <TableCell>
                <div className="flex items-center gap-2.5">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-zinc-100 font-mono text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    {initials(r.name, r.email)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.name || r.email}</p>
                    <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
                      {r.employment_type}
                      {!r.linked && (
                        <span className="inline-flex items-center gap-1 normal-case tracking-normal text-amber-600 dark:text-amber-500">
                          <CircleAlert className="h-3 w-3" /> not matched
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              </TableCell>
              <TableCell className="text-right font-mono text-sm tabular-nums">{r.completed}</TableCell>
              <TableCell className="text-right font-mono text-sm tabular-nums">{r.open}</TableCell>
              <TableCell className="text-right">
                {/* severity reads at a glance, and is never colour alone */}
                {r.overdue > 0 ? (
                  <Badge variant="outline" className="border-red-200 bg-red-50 font-mono tabular-nums text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">
                    {r.overdue} overdue
                  </Badge>
                ) : (
                  <span className="font-mono text-sm tabular-nums text-zinc-300 dark:text-zinc-600">0</span>
                )}
              </TableCell>
              <TableCell className="text-right font-mono text-sm tabular-nums text-zinc-500">{r.eventCount}</TableCell>
              <TableCell className="font-mono text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
                {sinceLabel(r.lastActivityAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  )
}

/** Member view: their own numbers. A one-row table would be a worse way to
 *  read four figures about yourself. */
function PersonalView({ row, days }: { row: Row | undefined; days: number }) {
  if (!row) return null
  const tiles = [
    { label: 'Completed', value: row.completed, hint: `in the last ${days} days` },
    { label: 'Open', value: row.open, hint: 'assigned to you now' },
    { label: 'Overdue', value: row.overdue, hint: `past due in ${row.timezone.split('/').pop()?.replace('_', ' ')}`, alert: row.overdue > 0 },
    { label: 'Events', value: row.eventCount, hint: `last ${sinceLabel(row.lastActivityAt)}` },
  ]

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {tiles.map(t => (
        <Card key={t.label} className={t.alert ? 'border-red-200 dark:border-red-900' : undefined}>
          <CardContent className="flex flex-col gap-1 py-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400">{t.label}</p>
            <p className={`font-mono text-3xl tabular-nums ${
              t.alert ? 'text-red-600 dark:text-red-400' : 'text-zinc-900 dark:text-zinc-100'
            }`}>
              {t.value}
            </p>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{t.hint}</p>
          </CardContent>
        </Card>
      ))}
      <p className="col-span-full flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
        <Activity className="h-3 w-3" /> Only your own activity is shown here — and only you and a super admin can see it.
      </p>
    </div>
  )
}
