'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ExternalLink, ArrowRight, CalendarClock } from 'lucide-react'
import { toast } from 'sonner'
import { STATUS_LABELS, STATUS_MEANING, schedulerIdsOf, type ItemStatus } from '../../lib/workflow-core'
import { choosePlatform, platformLabel } from '../../lib/posting-card-core'
import { approvalChip } from '../../lib/posting-approval-core'
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
import { useWorkRows } from '../useLiveWork'
import { defaultAllows } from '../../lib/page-access-core'
import { ClaimButton } from '../production/ClaimButton'
import { ScopeSwitch } from '../production/ScopeSwitch'
import { TurnChip } from '../production/TurnChip'
import { AccountUnavailable } from '../production/shoot-ui'
import { usePersistedScope, useTeamNames } from '../production/workHooks'
import { useRole } from '../useRole'
import TintCard from '../ui/TintCard'
import Stat from '../ui/Stat'
import Chip from '../ui/Chip'
import WorkCard from '../ui/WorkCard'
import { GATE_TONE, cardTone } from '../ui/tone'
import { useTable } from '@/lib/db-client'
import CommentsDrawer, { CommentsButton, useCommentsDrawer } from '../../components/comments/CommentsDrawer'

type ScheduleEntry = { platform: string; scheduled_at: string | null; live_url: string | null }
/** the live `schedule_entries` row, as the listener delivers it */
type ScheduleEntryRow = ScheduleEntry & { id: string; item_id: string }
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
  /** the final-post gate — absent on a database without the migration, and
   *  the row then wears no chip at all */
  posting_approval_state?: string | null
  clients: { name: string; timezone?: string | null } | null
  work_kinds?: { slug?: string } | null
  /** somebody tagged the viewer in a comment here and it is not done */
  my_open_task?: boolean
}

/** The three tabs, in the status's own words — the same words the Editor
 *  board's last column and the item badge use, so the hand-off says one thing. */
const LANES = SCHEDULER_LANES


const SCOPE_KEY = 'md-scheduler-scope'

/** The QUEUE view. Calendar is a sibling route; the shared header and view
 *  switcher live in layout.tsx. */
export default function SchedulerPage() {
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
  // memoised: this is the memo key `useWorkRows` scopes the whole table by,
  // and a fresh object per render re-ran that on every keystroke in the
  // search box
  const viewer: Viewer | null = useMemo(
    () => (me ? { id: me.id, role: me.role } : null), [me])

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
   * THE QUEUE, LIVE.
   *
   * This page used to load itself with one call for the list and then ONE
   * MORE CALL PER ROW to find each item's posting times — forty round trips
   * on a busy week, every time anything anywhere changed. It now renders from
   * database listeners: the queue and the schedule entries arrive in one
   * snapshot each and repaint themselves the instant an approval, a claim or
   * a posting time lands, whoever made it.
   *
   * The rows are scoped exactly as `/api/production/items` scoped them —
   * `app/lib/scope-client.ts`, unit-tested against the server's predicate —
   * and every write below is still its own API call.
   */
  const live = useWorkRows(viewer)
  const items: Item[] | null = live.loading ? null : (live.items as unknown as Item[])

  /**
   * A LISTENER THAT COULD NOT READ IS NOT AN EMPTY BOARD.
   *
   * The old page toasted 'Failed to load queue' when its fetch threw. Drawing
   * nothing and saying nothing is worse than that was — an empty board looks
   * like an answer. Toasted once per failure, not once per render.
   */
  const liveError = live.error
  useEffect(() => {
    if (liveError) toast.error('Failed to load queue')
  }, [liveError])
  const scheduleRows = useTable<ScheduleEntryRow>('schedule_entries', { enabled: viewer !== null })
  const schedules = useMemo(() => {
    const byItem: Record<string, ScheduleEntry[]> = {}
    for (const e of scheduleRows.rows) {
      (byItem[e.item_id] ??= []).push({
        platform: e.platform, scheduled_at: e.scheduled_at, live_url: e.live_url,
      })
    }
    return byItem
  }, [scheduleRows.rows])

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

  /** Where the FINAL POST stands — the caption-and-timing sign-off. Rows the
   *  gate never touched (and databases without the migration) wear nothing. */
  const gateChip = (item: Item) => {
    const chip = approvalChip(item.posting_approval_state)
    if (!chip) return null
    return <Chip tone={GATE_TONE[chip.tone]}>{chip.label}</Chip>
  }

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

      {/* THE STRIP: the queue in three numbers, before any row is read.
          Amber is what is waiting on a person, blue is booked, green is out.
          Every number is the same count the pills carry — one source. */}
      <div className="grid gap-3 sm:grid-cols-3">
        <TintCard tone="amber" title="Needs a posting date">
          <div className="flex gap-7">
            <Stat value={counts.approved_for_scheduling ?? 0} label="waiting on a time" />
            <Stat value={openPool} label="nobody has taken" />
          </div>
        </TintCard>
        <TintCard tone="blue" title="In the calendar">
          <Stat value={counts.scheduled ?? 0} label="have a posting time" />
        </TintCard>
        <TintCard tone="green" title="Already out"
          action={{ label: 'Posting calendar', href: '/dashboard/scheduler/calendar' }}>
          <Stat value={counts.published ?? 0} label="live" />
        </TintCard>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {/* The three steps, as the same pressed-button rail the scope switch
            and the view switch are. NOT role="tablist": that promises
            aria-controls, a tabpanel and arrow-key roving to a screen reader,
            and half a promise is worse than none. These are buttons that
            filter a list, and aria-pressed is exactly what they do. */}
        <div role="group" aria-label="Which step to show"
          className="flex max-w-full items-center gap-1.5 overflow-x-auto rounded-full border border-border bg-surface p-1">
          {LANES.map(l => {
            const active = l.key === lane
            return (
              <button key={l.key} type="button" aria-pressed={active}
                onClick={() => setLane(l.key)}
                className={`flex min-h-11 shrink-0 items-center gap-2 rounded-full px-4 text-[14px] font-semibold transition-colors ${
                  active ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
                }`}>
                {l.title}
                <span className={`text-[12px] font-bold tabular-nums ${active ? 'opacity-80' : 'text-foreground/60'}`}>
                  {counts[l.key] ?? 0}
                </span>
              </button>
            )
          })}
        </div>
        <div className="ml-auto">
          <ScopeSwitch scope={scope} onChange={setScope} unassignedCount={openPool}
            unassignedHint="Not handed to a specific person yet — any scheduler can take it." />
        </div>
      </div>

      {/* what the open tab MEANS — the status's own sentence, not a legend
          in the smallest type on the page. Guessing wrong costs a post. */}
      <p className="text-[15px] text-muted-foreground">
        {lane === 'approved_for_scheduling'
          ? <>{STATUS_MEANING.approved_for_scheduling} <HelpHint term="approved_for_scheduling" /></>
          : lane === 'scheduled'
            ? 'Scheduled means at least one platform has a posting time. Nothing here is live yet.'
            : 'Published means at least one platform is live. Nothing left to do.'}
      </p>

      {!ready ? (
        <div className="flex flex-col gap-2.5">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 w-full rounded-inner" />)}
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-card border border-border bg-surface px-6 py-14 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-tile bg-foreground/[0.06]">
            <CalendarClock className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="text-[17px] font-semibold">
            {lane === 'scheduled' ? 'Nothing scheduled yet.'
              : lane === 'published' ? 'Nothing published yet.'
              : 'Nothing to schedule yet.'}
          </p>
          <p className="max-w-sm text-[15px] text-muted-foreground">
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
              <Button className="h-11 rounded-full bg-foreground px-5 text-[14px] font-semibold text-background hover:bg-foreground/90"
                onClick={() => setLane('approved_for_scheduling')}>
                Schedule the {counts.approved_for_scheduling} waiting <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            )}
            {showingOnlyMineAndPool && lane === 'approved_for_scheduling' && (
              <Button className="h-11 rounded-full border border-border bg-surface px-4 text-[14px] font-semibold text-foreground hover:bg-foreground/[0.04]"
                onClick={() => setScope(new Set<ScopeMode>(['all']))}>
                Show everyone&rsquo;s
              </Button>
            )}
            {/* a page you cannot act on and cannot leave is a dead end —
                point at where the work is coming from */}
            {canSeeEditor && (
              <Button className="h-11 rounded-full border border-border bg-surface px-4 text-[14px] font-semibold text-foreground hover:bg-foreground/[0.04]" asChild>
                <Link href="/dashboard/editor">
                  See what&rsquo;s still being edited <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            )}
          </div>
        </div>
      ) : (
        /* ONE ROW SHAPE, EVERY WIDTH.
         *
         * There used to be two: a card list under 768px and a five-column
         * table above it, holding the same facts in two places and drifting
         * apart every time one of them was touched. The card is the shape
         * that survives — it is the board's card, so a scheduler reads the
         * queue the same way they read Production and the Editor — and every
         * column the table had is a chip or a line on it. */
        <div className="flex flex-col gap-2.5">
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
            const canTake = lane === 'approved_for_scheduling' && assignment === 'unassigned'
              && canClaimScheduler(item, viewer!)
            return (
              <WorkCard
                key={item.id}
                href={`/dashboard/production/${item.id}`}
                client={item.clients?.name ?? '—'}
                title={item.title}
                tone={cardTone({ status: item.status, changesRequested: approvalChip(item.posting_approval_state)?.tone === 'changes' })}
                chips={<>
                  <Chip className="capitalize">{item.content_type}</Chip>
                  <Chip className="tabular-nums">v{item.current_version_number}</Chip>
                  {(item.slide_count ?? 0) > 1 && <Chip>{slideCountLabel(item.slide_count ?? 0)}</Chip>}
                  {/* one component answers "is this on me?" — the same one
                      the other two work pages use. The parallel you /
                      Unassigned pills said it a second time, in different
                      words, on the same row. */}
                  <TurnChip status={item.status} item={item} viewer={viewer!} openTask={item.my_open_task}
                    onOpenComments={() => commentsDrawer.open(item.id, item.title)} />
                  {/* how this one goes out — in words, not "Auto" / "Manual":
                      nobody has to open the item to find out whether a human
                      still owes it a click. */}
                  <Chip tone={postsFromApp ? 'blue' : 'muted'}>
                    {postsFromApp
                      ? (item.status === 'approved_for_scheduling' ? 'Posts itself' : 'Queued — posts itself')
                      : 'Posted by hand'}
                  </Chip>
                  {gateChip(item)}
                  {assignment === 'other' && handedNames.length > 0 && (
                    <Chip>Handed to {handedNames.join(', ')}</Chip>
                  )}
                  {lane === 'approved_for_scheduling' && (
                    // `surface`, not `green`: the card underneath is already
                    // the green tint (approved), and a green chip on a green
                    // card is a chip nobody can see. Chip's contract has the
                    // white pill for exactly this — a chip sitting on a tint.
                    <Chip tone="surface">{STATUS_LABELS.approved_for_scheduling}</Chip>
                  )}
                  {entries.map(e => (
                    <span key={e.platform} className="flex items-center gap-1">
                      <Chip className="capitalize">
                        {e.platform}
                        {e.scheduled_at && (
                          // the audience's zone, with its letters: this queue
                          // is read by schedulers in more than one country,
                          // and a bare date is a date in whichever of them is
                          // holding the mouse
                          <span className="tabular-nums"
                            title={[
                              formatWithZone(e.scheduled_at, itemTz),
                              viewerHint(e.scheduled_at, itemTz, viewerTz),
                            ].filter(Boolean).join(' ')}>
                            {formatInZone(e.scheduled_at, itemTz, 'short')} {zoneAbbrev(itemTz, e.scheduled_at)}
                          </span>
                        )}
                      </Chip>
                      {e.live_url && (
                        // the one thing on the chip row that is its own
                        // destination, so it — and only it — rides above the
                        // card's stretched link
                        <a href={e.live_url} target="_blank" rel="noreferrer noopener"
                          className="relative z-10 flex h-11 w-11 items-center justify-center rounded-full text-accent-green hover:bg-foreground/[0.06]"
                          aria-label={`Live on ${e.platform}`}>
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      )}
                    </span>
                  ))}
                  {/* the conversation, right here — the drawer, not a page trip */}
                  <CommentsButton className="ml-auto" tagged={item.my_open_task} title={item.title}
                    onOpen={() => commentsDrawer.open(item.id, item.title)} />
                </>}
                note={item.caption
                  ? <span className="line-clamp-2">{item.caption}</span>
                  : undefined}
                actions={<>
                  {/* ONE primary per row: take it if nobody has, else the
                      posting action. Both filled at once was two blue buttons
                      asking two different questions. */}
                  {canTake && <ClaimButton itemId={item.id} hat="scheduler" onDone={() => {}} />}
                  <Button
                    className={canTake || lane !== 'approved_for_scheduling'
                      ? 'h-11 rounded-full border border-border bg-surface px-4 text-[14px] font-semibold text-foreground hover:bg-foreground/[0.04]'
                      : 'h-11 rounded-full bg-foreground px-5 text-[14px] font-semibold text-background hover:bg-foreground/90'}
                    asChild>
                    {/* the click opens the item's posting card, which is where
                        the one real action lives — the row names that action
                        rather than describing a page */}
                    <Link href={`/dashboard/production/${item.id}`}>
                      {canTake ? 'Open' : actionLabel} <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </Button>
                </>}
              />
            )
          })}
        </div>
      )}

      {/* the side drawer: this queue's rows open it via the comment button */}
      <CommentsDrawer target={commentsDrawer.target} onClose={commentsDrawer.close} />
    </div>
  )
}
