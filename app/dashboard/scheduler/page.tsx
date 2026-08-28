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
import { STATUS_LABELS, STATUS_MEANING, schedulerIdsOf, type ItemStatus } from '../../lib/workflow-core'
import { choosePlatform, platformLabel } from '../../lib/posting-card-core'
import {
  SCHEDULER_LANES, canClaimScheduler, schedulerAssignment, schedulerScope, unassignedCount,
  type ScopeMode, type Viewer,
} from '../../lib/work-pages-core'
import GettingStarted from '../GettingStarted'
import HelpHint from '../HelpHint'
import { slideCountLabel } from '../../lib/version-files-core'
import {
  DEFAULT_TZ, formatInZone, formatWithZone, viewerHint, zoneAbbrev,
} from '../../lib/timezone-core'
import { useProductionLive } from '../production/useProductionLive'
import { useOrderedLoad } from '../useOrderedLoad'
import { defaultAllows } from '../../lib/page-access-core'
import { ClaimButton } from '../production/ClaimButton'
import { ScopeSwitch } from '../production/ScopeSwitch'
import { TurnChip } from '../production/TurnChip'
import { AccountUnavailable } from '../production/shoot-ui'
import { usePersistedScope, useTeamNames } from '../production/workHooks'
import { useRole } from '../useRole'
import CommentsDrawer, { CommentsButton, useCommentsDrawer } from '../../components/comments/CommentsDrawer'

type ScheduleEntry = { platform: string; scheduled_at: string | null; live_url: string | null }
type Item = {
  id: string
  client_id?: string | null
  platform_targets?: string[] | null
  title: string
  content_type: string
  status: ItemStatus
  caption: string | null
  current_version_number: number
  /** how many slides the latest version holds — a carousel is a different
   *  job from a single post, and the row has to say which this is */
  slide_count?: number
  owner_id: string | null
  scheduler_ids?: unknown
  clients: { name: string; timezone?: string | null } | null
  work_kinds?: { slug?: string } | null
  /** somebody tagged the viewer in a comment here and it is not done */
  my_open_task?: boolean
}

/** The three tabs, in the status's own words — the same words the Editor
 *  board's last column and the item badge use, so the hand-off says one thing. */
const LANES = SCHEDULER_LANES

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
  /** which platforms each client has connected — so a row can say whether the
   *  next move is "schedule it" or "we can't post for them yet" */
  const [connected, setConnected] = useState<Record<string, string[]>>({})
  /** where the reader is — for the "= your time" tooltips only */
  const [viewerTz, setViewerTz] = useState<string | null>(null)
  useEffect(() => {
    try { setViewerTz(Intl.DateTimeFormat().resolvedOptions().timeZone || null) } catch { /* no hint */ }
  }, [])

  const { me, role, loading, can } = useRole()
  const isManager = can('account_manager')
  const viewer: Viewer | null = me ? { id: me.id, role: me.role } : null

  // the comments drawer: read and answer an item's comments without leaving
  // the queue. `?comments=<itemId>` opens it on load (notification links).
  const commentsDrawer = useCommentsDrawer()

  // only a manager may read the team list — everyone else gets the fact
  // without the name, which is all the row needs to say
  const nameById = useTeamNames(isManager)
  const [scope, setScope] = usePersistedScope(SCOPE_KEY, role)
  // the empty-state link is to another PAGE — only offer it to someone who
  // may open it. No grants are loaded here, so this is the role default.
  const canSeeEditor = defaultAllows(me?.role ?? null, '/dashboard/editor')

  /**
   * The queue, refetched with its answers kept in order — and never dropped.
   *
   * One fetcher, one apply. "I'll schedule this" used to leave the card where
   * it was: the claim announced itself, that hint issued a second refetch, and
   * the old rule discarded the claim's own answer for being one ticket behind.
   * See lib/load-order.ts.
   */
  const loadOrdered = useOrderedLoad<{ items: Item[]; schedules: Record<string, ScheduleEntry[]> }>(
    async () => {
      const res = await fetch('/api/production/items', { cache: 'no-store' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to load queue')
      const all: Item[] = await res.json()
      // schedule entries for scheduled/published rows (small N, parallel).
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
      return { items: all, schedules: Object.fromEntries(entries) }
    },
    data => { setItems(data.items); setSchedules(data.schedules) },
  )
  const load = useCallback(async () => {
    try {
      await loadOrdered()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load queue')
      setItems([])
    }
  }, [loadOrdered])

  useEffect(() => { load() }, [load])

  // one call for every client's channels — the queue's whole job is telling a
  // scheduler what to do next, and "send them a connect link" is a different
  // job from "pick a time"
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/social/accounts', { cache: 'no-store' })
        if (!res.ok) return
        const json = await res.json()
        const map: Record<string, string[]> = {}
        for (const a of (json.accounts ?? []) as { client_id: string | null; platform: string; active: boolean }[]) {
          if (!a.active || !a.client_id) continue
          ;(map[a.client_id] ??= []).push(String(a.platform).toLowerCase())
        }
        if (!cancelled) setConnected(map)
      } catch {
        // the queue still works without it — every row falls back to "Open"
      }
    })()
    return () => { cancelled = true }
  }, [])

  // live queue: an approval lands in "To schedule" the moment the AM clicks it
  useProductionLive(load)

  const ready = items !== null && viewer !== null
  const all = items ?? []
  const queue = ready ? schedulerScope(all, viewer!, scope) : []
  const visible = queue.filter(i => i.status === lane)
  const counts = Object.fromEntries(LANES.map(l => [l.key, queue.filter(i => i.status === l.key).length]))
  // the pool is what can still be TAKEN — a published row cannot, so counting
  // it advertised a pool with nothing in it to pick up
  const openPool = ready
    ? unassignedCount(
      schedulerScope(all, viewer!, new Set<ScopeMode>(['all'])).filter(i => i.status !== 'published'),
      viewer!, schedulerAssignment,
    )
    : 0
  const showingOnlyMineAndPool = !scope.has('all')

  // the queue is drawn per viewer, so no viewer is a different screen — not a
  // slower load. A skeleton that never resolves tells the user nothing.
  if (!loading && !viewer) return <AccountUnavailable />


  /** The one thing to do with this row, named by what happens. */
  const rowAction = (item: Item) => {
    const clientChannels = connected[item.client_id ?? ''] ?? []
    const platform = choosePlatform(item.platform_targets ?? [], clientChannels)
    const postsFromApp = clientChannels.includes(platform)
    const label = lane !== 'approved_for_scheduling'
      ? 'Open'
      : postsFromApp ? `Schedule on ${platformLabel(platform)}` : 'Set the posting time'
    return { platform, postsFromApp, label }
  }

  return (
    <div className="flex flex-col gap-4">
      {ready && <GettingStarted role={role} page="scheduler" />}

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={lane} onValueChange={v => v && setLane(v)}>
          <TabsList className="h-auto">
            {LANES.map(l => (
              <TabsTrigger key={l.key} value={l.key} className="min-h-11 gap-1.5 md:min-h-8">
                {l.title}
                <span className="font-mono text-[11px] tabular-nums text-zinc-400">{counts[l.key] ?? 0}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="ml-auto">
          <ScopeSwitch scope={scope} onChange={setScope} unassignedCount={openPool}
            unassignedHint="Not handed to a specific person yet — any scheduler can take it." />
        </div>
      </div>

      {/* what the open tab MEANS — the status's own sentence, not a legend
          in the smallest type on the page. Guessing wrong costs a post. */}
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        {lane === 'approved_for_scheduling'
          ? <>{STATUS_MEANING.approved_for_scheduling} <HelpHint term="approved_for_scheduling" /></>
          : lane === 'scheduled'
            ? 'Scheduled means at least one platform has a posting time. Nothing here is live yet.'
            : 'Published means at least one platform is live. Nothing left to do.'}
      </p>

      {!ready ? (
        <Card>
          <CardContent className="flex flex-col gap-3 p-6">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </CardContent>
        </Card>
      ) : visible.length === 0 ? (
        <Card className="border-dashed shadow-none">
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <CalendarClock className="h-6 w-6 text-zinc-300 dark:text-zinc-600" />
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
              {lane === 'scheduled' ? 'Nothing scheduled yet.'
                : lane === 'published' ? 'Nothing published yet.'
                : 'Nothing to schedule yet.'}
            </p>
            <p className="max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
              {lane === 'scheduled'
                ? 'Set a posting time on an item under "Needs a posting date" and it moves here.'
                : lane === 'published'
                  ? 'Once a scheduled post goes live it moves here, with its link.'
                : !showingOnlyMineAndPool
                  ? 'Items appear here the moment an account manager signs them off. Until then they are on the Editor board.'
                  : scope.has('mine') && scope.has('unassigned')
                    ? 'Nothing handed to you and nothing free to take — approved items land here the moment an account manager signs them off.'
                    : scope.has('mine')
                      ? 'Nothing has been handed to you to schedule.'
                      : 'Nothing free to take — every approved item already has someone on it.'}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {lane !== 'approved_for_scheduling' && (counts.approved_for_scheduling ?? 0) > 0 && (
                <Button size="sm" className="min-h-11" onClick={() => setLane('approved_for_scheduling')}>
                  Schedule the {counts.approved_for_scheduling} waiting <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              )}
              {showingOnlyMineAndPool && lane === 'approved_for_scheduling' && (
                <Button variant="outline" size="sm" className="min-h-11" onClick={() => setScope(new Set<ScopeMode>(['all']))}>
                  Show everyone&rsquo;s
                </Button>
              )}
              {/* a page you cannot act on and cannot leave is a dead end —
                  point at where the work is coming from */}
              {canSeeEditor && (
                <Button variant="outline" size="sm" className="min-h-11" asChild>
                  <Link href="/dashboard/editor">
                    See what&rsquo;s still being edited <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
        {/* PHONE: one card per item, the action as a full-width button. A
            five-column table clipped its last two columns — the action
            column among them — on every phone. */}
        <div className="flex flex-col gap-2 md:hidden">
          {visible.map(item => {
            const assignment = schedulerAssignment(item, viewer!)
            const { postsFromApp, label } = rowAction(item)
            const itemTz = item.clients?.timezone || DEFAULT_TZ
            const entries = schedules[item.id] ?? []
            const canTake = lane === 'approved_for_scheduling' && assignment === 'unassigned' && canClaimScheduler(item, viewer!)
            return (
              <Card key={item.id} className="py-0">
                <CardContent className="flex flex-col gap-2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium leading-snug">{item.title}</p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {item.clients?.name ?? '—'} · <span className="capitalize">{item.content_type}</span>
                        {(item.slide_count ?? 0) > 1 && ` · ${slideCountLabel(item.slide_count ?? 0)}`}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                      postsFromApp ? 'bg-cyan-50 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-400' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
                    }`}>
                      {postsFromApp ? 'Posts itself' : 'Posted by hand'}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <TurnChip status={item.status} item={item} viewer={viewer!} openTask={item.my_open_task}
                      onOpenComments={() => commentsDrawer.open(item.id, item.title)} />
                    {entries.map(e => (
                      <Badge key={e.platform} variant="outline" className="font-normal capitalize text-zinc-600 dark:text-zinc-400">
                        {e.platform}
                        {e.scheduled_at && <span className="ml-1 font-mono text-[11px] normal-case">{formatInZone(e.scheduled_at, itemTz, 'short')} {zoneAbbrev(itemTz, e.scheduled_at)}</span>}
                      </Badge>
                    ))}
                    {/* the conversation, right here — the drawer, not a page trip */}
                    <CommentsButton className="ml-auto" tagged={item.my_open_task} title={item.title}
                      onOpen={() => commentsDrawer.open(item.id, item.title)} />
                  </div>
                  {item.caption && <p className="line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">{item.caption}</p>}
                  <div className="flex flex-col gap-2">
                    {canTake && <ClaimButton itemId={item.id} hat="scheduler" onDone={load} />}
                    <Button variant={canTake ? 'outline' : 'default'} size="sm" className="min-h-11 w-full" asChild>
                      <Link href={`/dashboard/production/${item.id}`}>{label} <ArrowRight className="h-3.5 w-3.5" /></Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>

        <Card className="hidden py-0 md:block">
          <Table>
            <TableHeader>
              <TableRow className="bg-zinc-50 hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-900">
                <TableHead>Item</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Caption</TableHead>
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
                // the row's next move follows the client's channels, not the
                // status: a client with nothing connected gets a posting time
                // recorded by hand, one with a channel gets it queued
                const { postsFromApp, label: actionLabel } = rowAction(item)
                // …and its posting times follow the client's zone, per row:
                // this queue mixes clients, so there is no one zone for the page
                const itemTz = item.clients?.timezone || DEFAULT_TZ
                return (
                  <TableRow key={item.id}>
                    <TableCell>
                      <div className="text-sm font-medium">{item.title}</div>
                      <div className="font-mono text-xs text-zinc-400 dark:text-zinc-500">
                        <span className="capitalize">{item.content_type}</span> · v{item.current_version_number}
                        {(item.slide_count ?? 0) > 1 && ` · ${slideCountLabel(item.slide_count ?? 0)}`}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {/* one component answers "is this on me?" — the same
                            one the other two work pages use. The parallel
                            you / Unassigned pills said it a second time, in
                            different words, on the same row. */}
                        <TurnChip status={item.status} item={item} viewer={viewer!} openTask={item.my_open_task}
                          onOpenComments={() => commentsDrawer.open(item.id, item.title)} />
                        {/* how this one goes out — in words, not "Auto" /
                            "Manual": nobody has to open the item to find out
                            whether a human still owes it a click. */}
                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                          postsFromApp
                            ? 'bg-cyan-50 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-400'
                            : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
                        }`}>
                          {postsFromApp
                            ? (item.status === 'approved_for_scheduling' ? 'Posts itself' : 'Queued — posts itself')
                            : 'Posted by hand'}
                        </span>
                        {assignment === 'other' && handedNames.length > 0 && (
                          <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                            Handed to {handedNames.join(', ')}
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
                                  // the audience's zone, with its letters: this
                                  // queue is read by schedulers in more than
                                  // one country, and a bare date is a date in
                                  // whichever of them is holding the mouse
                                  <span className="ml-1 font-mono text-[11px]"
                                    title={[
                                      formatWithZone(e.scheduled_at, itemTz),
                                      viewerHint(e.scheduled_at, itemTz, viewerTz),
                                    ].filter(Boolean).join(' ')}>
                                    {formatInZone(e.scheduled_at, itemTz, 'short')} {zoneAbbrev(itemTz, e.scheduled_at)}
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
                        {/* the conversation, right here — the drawer, not a
                            page trip */}
                        <CommentsButton tagged={item.my_open_task} title={item.title}
                          onOpen={() => commentsDrawer.open(item.id, item.title)} />
                        {/* ONE primary per row: take it if nobody has, else
                            the posting action. Both filled at once was two
                            blue buttons asking two different questions. */}
                        {lane === 'approved_for_scheduling' && assignment === 'unassigned'
                          && canClaimScheduler(item, viewer!) ? (
                          <>
                            <ClaimButton itemId={item.id} hat="scheduler" onDone={load} />
                            <Button variant="outline" size="sm" asChild>
                              <Link href={`/dashboard/production/${item.id}`}>Open</Link>
                            </Button>
                          </>
                        ) : (
                          <Button variant={lane === 'approved_for_scheduling' ? 'default' : 'outline'} size="sm" asChild>
                            {/* the click opens the item's posting card, which is
                                where the one real action lives — the row names
                                that action rather than describing a page */}
                            <Link href={`/dashboard/production/${item.id}`}>
                              {actionLabel} <ArrowRight className="h-3.5 w-3.5" />
                            </Link>
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Card>
        </>
      )}

      {/* the side drawer: this queue's rows open it via the comment button */}
      <CommentsDrawer target={commentsDrawer.target} onClose={commentsDrawer.close} />
    </div>
  )
}
