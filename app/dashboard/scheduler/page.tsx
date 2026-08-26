'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { ExternalLink, ArrowRight, CalendarClock } from 'lucide-react'
import { STATUS_LABELS, schedulerIdsOf, type ItemStatus } from '../../lib/workflow-core'
import {
  canClaimScheduler, defaultScope, schedulerAssignment, schedulerScope, unassignedCount,
  type ScopeMode, type ScopeSet, type Viewer,
} from '../../lib/work-pages-core'
import { useProductionLive } from '../production/useProductionLive'
import { ClaimButton } from '../production/ClaimButton'
import { ScopeSwitch } from '../production/ScopeSwitch'
import { useRole } from '../useRole'

type ScheduleEntry = { platform: string; scheduled_at: string | null; live_url: string | null }
type Item = {
  id: string
  title: string
  content_type: string
  status: ItemStatus
  caption: string | null
  current_version_number: number
  owner_id: string | null
  scheduler_ids?: unknown
  clients: { name: string } | null
  work_kinds?: { slug?: string } | null
}

const LANES = [
  { key: 'approved_for_scheduling', label: 'To schedule' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'published', label: 'Published' },
] as const

const STATUS_BADGE: Record<string, string> = {
  approved_for_scheduling: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900',
  scheduled: 'bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-950/40 dark:text-cyan-400 dark:border-cyan-900',
  published: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900',
}

const SCOPE_KEY = 'md-scheduler-scope'

/** The QUEUE view. Calendar is a sibling route; the shared header and view
 *  switcher live in layout.tsx. */
export default function SchedulerPage() {
  const [items, setItems] = useState<Item[] | null>(null)
  const [schedules, setSchedules] = useState<Record<string, ScheduleEntry[]>>({})
  const [lane, setLane] = useState<string>('approved_for_scheduling')

  const { me, role, can } = useRole()
  const isManager = can('account_manager')
  const viewer: Viewer | null = me ? { id: me.id, role: me.role } : null

  // only a manager may read the team list — everyone else gets the fact
  // without the name, which is all the row needs to say
  const [team, setTeam] = useState<{ id: string; name: string; email: string }[]>([])
  useEffect(() => {
    if (!isManager) return
    fetch('/api/team')
      .then(r => (r.ok ? r.json() : { members: [] }))
      .then(json => setTeam(
        (json.members ?? []).map((m: { id: string; name: string; email: string }) => ({ id: m.id, name: m.name, email: m.email })),
      ))
      .catch(() => setTeam([]))
  }, [isManager])

  /* ── scope: whose queue is on screen ── */
  const [scope, setScopeState] = useState<ScopeSet | null>(null)
  useEffect(() => {
    if (role === null || scope !== null) return
    try {
      const saved = localStorage.getItem(SCOPE_KEY)
      const parsed: unknown = saved ? JSON.parse(saved) : null
      // whatever is in storage is a guess, not a fact — an old key, a hand-edit,
      // a mode we have since renamed. Keep the words we still understand; if
      // that leaves nothing, open where this role would have opened anyway.
      const restored = Array.isArray(parsed)
        ? parsed.filter((v): v is ScopeMode => v === 'mine' || v === 'unassigned' || v === 'all')
        : []
      if (restored.length > 0) {
        setScopeState(new Set(restored))
        return
      }
    } catch { /* a corrupt or blocked localStorage is not worth a broken queue */ }
    setScopeState(defaultScope(role))
  }, [role, scope])
  const setScope = (s: ScopeSet) => {
    setScopeState(s)
    try { localStorage.setItem(SCOPE_KEY, JSON.stringify([...s])) } catch { /* private mode */ }
  }

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/production/items')
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to load queue')
      const all: Item[] = await res.json()
      setItems(all)
      // fetch schedule entries for scheduled/published rows (small N, parallel).
      // a shoot brief rides this same status pipeline but is never scheduled,
      // so it never has entries to fetch — schedulerScope drops it on screen.
      const withSchedule = all
        .filter(i => i.work_kinds?.slug !== 'shoot_brief')
        .filter(i => i.status === 'scheduled' || i.status === 'published')
        .slice(0, 40)
      const entries = await Promise.all(
        withSchedule.map(async i => {
          const r = await fetch(`/api/production/items/${i.id}`)
          if (!r.ok) return [i.id, []] as const
          const d = await r.json()
          return [i.id, (d.schedule ?? []) as ScheduleEntry[]] as const
        })
      )
      setSchedules(Object.fromEntries(entries))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load queue')
      setItems([])
    }
  }, [])

  useEffect(() => { load() }, [load])

  // live queue: an approval lands in "To schedule" the moment the AM clicks it
  useProductionLive(load)

  const ready = items !== null && viewer !== null && scope !== null
  const all = items ?? []
  const queue = ready ? schedulerScope(all, viewer!, scope!) : []
  const visible = queue.filter(i => i.status === lane)
  const counts = Object.fromEntries(LANES.map(l => [l.key, queue.filter(i => i.status === l.key).length]))
  const openPool = ready
    ? unassignedCount(schedulerScope(all, viewer!, new Set<ScopeMode>(['all'])), viewer!, schedulerAssignment)
    : 0
  const nameById = new Map(team.map(m => [m.id, m.name || m.email]))
  const showingOnlyMineAndPool = scope !== null && !scope.has('all')

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={lane} onValueChange={v => v && setLane(v)}>
          <TabsList>
            {LANES.map(l => (
              <TabsTrigger key={l.key} value={l.key} className="gap-1.5">
                {l.label}
                <span className="font-mono text-[11px] tabular-nums text-zinc-400">{counts[l.key] ?? 0}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {scope && (
          <div className="ml-auto">
            <ScopeSwitch scope={scope} onChange={setScope} unassignedCount={openPool}
              unassignedHint="Not handed to a specific person yet — any scheduler can take it." />
          </div>
        )}
      </div>

      {/* the two lane names mean precise things, and guessing wrong costs a post */}
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Scheduled means at least one platform has a date; Published means at least one platform is live.
      </p>

      {!ready ? (
        <Card>
          <CardContent className="flex flex-col gap-3 p-6">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </CardContent>
        </Card>
      ) : visible.length === 0 ? (
        <Card className="border-dashed shadow-none">
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
            <CalendarClock className="h-6 w-6 text-zinc-300 dark:text-zinc-600" />
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {lane !== 'approved_for_scheduling'
                ? 'Nothing here yet.'
                : showingOnlyMineAndPool
                  ? 'Nothing handed to you and nothing waiting — approved items land here the moment an account manager signs them off.'
                  : 'Nothing waiting — items appear here the moment they’re approved for scheduling.'}
            </p>
            {showingOnlyMineAndPool && (
              <Button variant="outline" size="sm" onClick={() => setScope(new Set<ScopeMode>(['all']))}>
                Show everyone
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-zinc-50 hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-900">
                <TableHead>Item</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Caption / instructions</TableHead>
                <TableHead>{lane === 'approved_for_scheduling' ? 'Status' : 'Platforms'}</TableHead>
                <TableHead className="w-28" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map(item => {
                const entries = schedules[item.id] ?? []
                const assignment = schedulerAssignment(item, viewer!)
                // who is holding it: a manager gets the names, everyone else
                // gets the fact — the row must never invent a name it can't see
                const handedNames = schedulerIdsOf(item)
                  .map(id => nameById.get(id))
                  .filter((n): n is string => !!n)
                return (
                  <TableRow key={item.id}>
                    <TableCell>
                      <div className="text-sm font-medium">{item.title}</div>
                      <div className="font-mono text-xs text-zinc-400 dark:text-zinc-500">
                        {item.content_type} · v{item.current_version_number}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {assignment === 'mine' && (
                          <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
                            you
                          </span>
                        )}
                        {assignment === 'other' && (
                          <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                            {handedNames.length > 0 ? `Handed to ${handedNames.join(', ')}` : 'handed to someone'}
                          </span>
                        )}
                        {assignment === 'unassigned' && (
                          <span className="rounded-full border border-dashed border-zinc-300 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:border-zinc-600 dark:text-zinc-400">
                            Unassigned
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-zinc-600 dark:text-zinc-400">{item.clients?.name ?? '—'}</TableCell>
                    <TableCell className="max-w-64">
                      <p className="truncate text-sm text-zinc-600 dark:text-zinc-400" title={item.caption ?? ''}>
                        {item.caption || <span className="text-zinc-300 dark:text-zinc-600">—</span>}
                      </p>
                    </TableCell>
                    <TableCell>
                      {lane === 'approved_for_scheduling' ? (
                        <Badge variant="outline" className={STATUS_BADGE[item.status]}>
                          {STATUS_LABELS.approved_for_scheduling}
                        </Badge>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {entries.length === 0 && <span className="text-xs text-zinc-400">—</span>}
                          {entries.map(e => (
                            <span key={e.platform} className="flex items-center gap-1">
                              <Badge variant="outline" className="font-normal capitalize text-zinc-600 dark:text-zinc-400">
                                {e.platform}
                                {e.scheduled_at && (
                                  <span className="ml-1 font-mono text-[11px]">
                                    {new Date(e.scheduled_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                                  </span>
                                )}
                              </Badge>
                              {e.live_url && (
                                <a href={e.live_url} target="_blank" rel="noreferrer noopener"
                                  className="text-emerald-600 dark:text-emerald-400" aria-label={`Live on ${e.platform}`}>
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              )}
                            </span>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {lane === 'approved_for_scheduling' && assignment === 'unassigned'
                          && canClaimScheduler(item, viewer!) && (
                          <ClaimButton itemId={item.id} hat="scheduler" label="I’ll schedule this" onDone={load} />
                        )}
                        <Button variant="outline" size="sm" asChild>
                          <Link href={`/dashboard/production/${item.id}`}>
                            {lane === 'approved_for_scheduling' ? 'Schedule' : 'Open'} <ArrowRight className="h-3.5 w-3.5" />
                          </Link>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  )
}
