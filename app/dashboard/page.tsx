'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { folderOf } from '../lib/card-link-core'
import { useRouter } from 'next/navigation'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  ArrowRight, CalendarClock, CheckCircle2, ClipboardList, Clock,
  ChevronLeft, ChevronRight, Hand,
} from 'lucide-react'
import GettingStarted from './GettingStarted'
import { LoadFailed } from './NotSetUp'
import type { Role } from '../lib/identity-core'
import TeamLoadCard from './TeamLoadCard'
import PageTitle from './ui/PageTitle'
import TintCard from './ui/TintCard'
import NoReviewerBanner from './ui/NoReviewerBanner'
import Stat from './ui/Stat'
import Chip, { type ChipTone } from './ui/Chip'
import MiniCalendar, { type Marker } from './ui/MiniCalendar'
import Timeline, { type TimelineItem } from './ui/Timeline'
import {
  DEFAULT_TZ, dayKeyInZone, formatInZone, greetingInZone, toZonedInput,
  viewerHint, zoneLabel,
} from '../lib/timezone-core'
import { useTable } from '@/lib/db-client'
import type {
  Lead, PostAnalytic, PublishJob, ScheduleEntry, SocialAccount, UserPageAccess,
} from '@/lib/db-types'
import PlatformIcon from './social/PlatformIcon'
import { useRole } from './useRole'
import { useWorkRows } from './useLiveWork'
import { buildOverview, LEADS_CAP, type OverviewItem } from '../lib/overview-core'
import { accessibleClientIdsOf } from '../lib/scope-client'
import { boardHref, overviewTiles, type BoardViewCard, type OverviewTile } from '../lib/board-view-core'
import {
  CALENDAR_PAGE, EDITOR_BOARD, POST_APPROVAL_BOARD, SHOOTS_PAGE, actionFor, cardHref, chipCount, linkAllowed, overviewChips, shootHref,
} from '../lib/overview-links-core'
import { briefIsLate, type SopShoot } from '../lib/shoot-sop-core'
import { BOARD_COLUMNS, boardColumn, columnOf, type BoardColumnKey } from '../lib/board-core'
import { STATUS_LABELS, type ItemStatus } from '../lib/workflow-core'
import { itemStatusLabel } from '../lib/brief-task-core'
import { compactCount } from '../lib/post-analytics-core'
import { byHandRows } from '../lib/post-outcome-core'
import {
  accountHandle, monthPostsByAccount, postCountsLine, postMetricsLine,
  NO_POSTS_THIS_MONTH, type AccountPostsRow, type MonthJob,
} from '../lib/overview-posts-core'
import {
  monthStages, NO_STAGES_THIS_MONTH, stagesLine, stagesTone, type ClientStagesRow, type StageCommitment,
} from '../lib/overview-stages-core'

type ItemLite = {
  id: string; title: string; status: ItemStatus; content_type: string
  priority: string; due_date: string | null
  clients: { name: string } | null
  work_kinds?: { slug?: string } | null
}
type LeadLite = { id: string; created_at: string; fname: string; lname: string; biz: string }
type UpcomingEntry = {
  id: string; platform: string; scheduled_at: string | null; item_id: string
  content_items: {
    id: string; title: string
    clients: { name: string; timezone?: string | null } | null
  } | null
}

/** items and shoots with an unresolved comment tagged to the viewer */
type WaitingOnYou = {
  items: ItemLite[]
  shoots: { id: string; title: string; clients: { name: string } | null; line?: string }[]
}
type Overview = {
  waiting_on_you?: WaitingOnYou
  role: string
  name: string
  pipeline: Record<string, number>
  editor?: {
    my_items: number
    in_internal_review: number
    revisions_needed: number
    needs_action: ItemLite[]
    due_soon: ItemLite[]
    due_soon_count?: number
    /** the open pool — absent on an older server */
    unassigned?: ItemLite[]
    unassigned_count?: number
  }
  scheduler?: {
    to_schedule: number
    queue: ItemLite[]
    upcoming: UpcomingEntry[]
    upcoming_count?: number
    published_week: number
  }
  manager?: {
    clients: number
    awaiting_internal_review: number
    awaiting_client: number
    revisions_open: number
    needs_review: ItemLite[]
    my_tasks?: ItemLite[]
    my_tasks_count?: number
    /** work sitting in nobody's queue — absent on an older server */
    unassigned_count?: number
    /** absent for managers without a Leads grant */
    leads_total?: number
    leads_week?: number
    latest_leads?: LeadLite[]
  }
}

/** newest first — module-level so the live query stays referentially stable */
const LEADS_NEWEST: ['created_at', 'desc'][] = [['created_at', 'desc']]

/**
 * The board's words for where a card is: its column, and — when the column
 * holds more than one stage — the stage chip after it, exactly as the board
 * draws it ("Internal check · Being changed"). A shoot plan keeps its own words.
 */
const statusLabel = (i: ItemLite) => {
  if (i.work_kinds?.slug === 'shoot_brief') return itemStatusLabel(i.work_kinds.slug, i.status, STATUS_LABELS[i.status])
  const col = boardColumn(columnOf(i.status))
  return col.statuses.length > 1 ? `${col.label} · ${STATUS_LABELS[i.status]}` : col.label
}

/** "1 card" / "4 cards" — the summary sentence reads as English or not at all. */
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** "instagram" is a proper noun on screen, exactly as the old badge printed it. */
const platformName = (p: string) => (p ? p.charAt(0).toUpperCase() + p.slice(1) : p)

/* ─────────────────────────────────────────────────────────────────────────
   The page's own small pieces: a section heading, a plain panel, and the
   tinted row the mockup's "Assigned to you" list is made of. Everything
   else comes from `app/dashboard/ui`.
   ───────────────────────────────────────────────────────────────────────── */

/** A heading with at most one link out of it — the mockup's section rule. */
function Section({ title, action, aside, children, className }: {
  title: string
  action?: { label: string; href: string }
  aside?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn('flex min-w-0 flex-col gap-3', className)}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="min-w-0 truncate text-section-title">{title}</h2>
        {aside}
        {action && (
          <Link href={action.href}
            className="-my-3 inline-flex min-h-11 shrink-0 items-center gap-1 text-[13px] font-semibold underline-offset-4 hover:underline">
            {action.label} <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.8} />
          </Link>
        )}
      </div>
      {children}
    </section>
  )
}

/** A white panel for the wider blocks (the month ledger, the leads list). */
function Panel({ title, right, children, className }: {
  title: string
  right?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn('flex min-w-0 flex-col gap-4 rounded-card border border-border bg-surface p-5 sm:p-6', className)}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="min-w-0 text-section-title">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  )
}

type RowTone = 'amber' | 'blue' | 'green' | 'surface'

/* only the amber row is tinted: in the mockup the thing that needs you today
   is the one that changes colour, and a page of tinted rows says nothing */
const ROW_BG: Record<RowTone, string> = {
  amber: 'border-transparent bg-tint-amber',
  blue: 'border-border bg-surface',
  green: 'border-border bg-surface',
  surface: 'border-border bg-surface',
}
const ROW_TILE: Record<RowTone, string> = {
  amber: 'bg-accent-amber text-ink',
  blue: 'bg-tint-blue text-accent-blue-deep dark:text-cream',
  green: 'bg-tint-green text-foreground',
  surface: 'bg-paper text-foreground',
}
const ROW_ICON: Record<RowTone, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  amber: Clock, blue: CalendarClock, green: CheckCircle2, surface: ClipboardList,
}
const ROW_CHIP: Record<RowTone, ChipTone> = {
  amber: 'surface', blue: 'blue', green: 'green', surface: 'muted',
}

/** One line of work: what it is, which client, and the one fact about it. */
function WorkRow({ href, tone = 'surface', title, detail, chip }: {
  href: string
  tone?: RowTone
  title: string
  detail?: string
  chip?: string
}) {
  const Icon = ROW_ICON[tone]
  return (
    <Link href={href}
      /* the hover is a border, not opacity: fading a dark row against a dark
         canvas is a change nobody can see */
      className={cn('flex min-h-[64px] items-center gap-3.5 rounded-inner border px-4 py-2.5 transition-colors hover:border-foreground/25', ROW_BG[tone])}>
      <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-tile', ROW_TILE[tone])}>
        <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[15px] font-semibold">{title}</span>
        {detail && <span className="truncate text-[13px] text-muted-foreground">{detail}</span>}
      </span>
      {chip && <Chip tone={ROW_CHIP[tone]} className="shrink-0">{chip}</Chip>}
    </Link>
  )
}

/** Amber is "today or your move", blue is "in the calendar", green is done. */
function toneOf(i: ItemLite, todayKey: string | null): RowTone {
  if (todayKey && i.due_date && i.due_date <= todayKey
    && !['published', 'scheduled'].includes(i.status)) return 'amber'
  if (['revision_required', 'client_changes_requested'].includes(i.status)) return 'amber'
  if (['published', 'approved_for_scheduling'].includes(i.status)) return 'green'
  if (['scheduled', 'client_review'].includes(i.status)) return 'blue'
  return 'surface'
}

/** The rows for a list of items, with the list's own loading and empty words. */
function ItemRows({ items, empty, todayKey, role }: {
  items: ItemLite[] | undefined
  empty: string
  todayKey: string | null
  /** whose Overview this is — the card opens on a board THIS role has */
  role: Role | null | undefined
}) {
  if (items === undefined) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-inner" />)}
      </div>
    )
  }
  if (items.length === 0) {
    return <p className="rounded-inner border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted-foreground">{empty}</p>
  }
  return (
    <div className="flex flex-col gap-2">
      {items.map(i => {
        const tone = toneOf(i, todayKey)
        const due = todayKey && i.due_date && i.due_date <= todayKey
          && !['published', 'scheduled'].includes(i.status)
        // the folder a scheduler was handed (the owner, 13 Sep 2026: "in their
        // UI on schedule or overview it will be folder to work from")
        const folderUrl = folderOf(i as Parameters<typeof folderOf>[0])?.url ?? null
        return (
          <div key={i.id} className="flex flex-col gap-1">
            <WorkRow
              href={cardHref(role, i)}
              tone={tone}
              title={i.clients?.name ? `${i.clients.name} · ${i.title}` : i.title}
              /* the status is the detail line; the chip only ever adds a SECOND
                 fact — printing "Being changed" twice on one row said nothing
                 twice */
              detail={statusLabel(i)}
              chip={due ? (i.due_date === todayKey ? 'Due today' : 'Overdue') : undefined}
            />
            {folderUrl && (
              <a href={folderUrl} target="_blank" rel="noreferrer noopener"
                className="inline-flex min-h-11 w-fit items-center gap-1 px-3 text-[13px] font-semibold underline underline-offset-4">
                Folder to work from<span className="sr-only">, opens in a new tab</span>
              </a>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** A client's last post, on that client's own calendar. */
const shortDate = (iso: string, tz?: string | null) =>
  formatInZone(iso, tz || DEFAULT_TZ, 'date') ?? ''



/**
 * "POSTS THIS MONTH" — one row per client account: what went out, what is
 * booked, what did not go out, and how those posts did.
 *
 * The owner, 10 Sep 2026: "for super admin they can see totals posted per
 * account and the metrics… if posted/scheduled then show that for the month".
 * A super admin sees every account; an account manager sees the accounts of
 * the clients they run. The counting is `monthPostsByAccount`, which asks the
 * Posts page's own core, so the two screens cannot disagree about what "went
 * out" means.
 */
/**
 * Produced · delivered · published this month, per client — the three words
 * the Team's Playbook asks for and no synonym. "3 of 4 delivered" is the
 * month's promise against the delivery stamp; amber once the month is mostly
 * gone and delivery is short.
 */
function StagesThisMonth({ rows, clients }: { rows: ClientStagesRow[] | null; clients: readonly { id: string; timezone?: string | null }[] }) {
  const now = new Date().toISOString()
  const tzOf = (id: string) => clients.find(c => c.id === id)?.timezone || DEFAULT_TZ
  return (
    <Panel title="Produced, delivered, published this month"
      right={<span className="shrink-0 text-[13px] text-muted-foreground">Delivered means the final was sent to the client</span>}>
      {rows === null && <Skeleton className="h-24 w-full rounded-inner" />}
      {rows !== null && rows.length === 0 && (
        <p className="py-6 text-center text-[13px] text-muted-foreground">{NO_STAGES_THIS_MONTH}</p>
      )}
      {rows !== null && rows.length > 0 && (
        <ul className="flex flex-col divide-y divide-border">
          {rows.map(r => (
            <li key={r.client_id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <Link href={`/dashboard/clients/${r.client_id}`}
                className="min-w-0 truncate text-[14px] font-semibold underline-offset-4 hover:underline">{r.client_name}</Link>
              <Chip tone={stagesTone(r, now, tzOf(r.client_id))}>{stagesLine(r)}</Chip>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function PostsThisMonth({ rows }: { rows: AccountPostsRow[] | null }) {
  return (
    <Panel title="Posts this month"
      right={<span className="shrink-0 text-[13px] text-muted-foreground">Every account, in its client&rsquo;s month</span>}>
      {rows === null && <Skeleton className="h-32 w-full rounded-inner" />}
      {rows !== null && rows.length === 0 && (
        <p className="py-6 text-center text-[13px] text-muted-foreground">{NO_POSTS_THIS_MONTH}</p>
      )}
      {rows !== null && rows.length > 0 && (
        <div className="flex flex-col gap-1">
          {rows.map(r => {
            const metrics = postMetricsLine(r, compactCount)
            return (
              <div key={r.key} className="flex items-start gap-3 rounded-inner px-3 py-2.5 hover:bg-foreground/[0.04]">
                <span className="mt-0.5 shrink-0">
                  {r.platform
                    ? <PlatformIcon platform={r.platform} size={20} />
                    : <span className="flex h-5 w-5 items-center justify-center rounded-tile bg-tint-green">
                        <Hand className="h-3 w-3" strokeWidth={1.8} />
                      </span>}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="truncate text-[15px] font-semibold">{accountHandle(r)}</span>
                    <span className="truncate text-[13px] text-muted-foreground">{r.client_name}</span>
                  </span>
                  <span className="text-[13px] tabular-nums text-muted-foreground">{postCountsLine(r)}</span>
                  {metrics && <span className="text-[12px] tabular-nums text-muted-foreground">{metrics}</span>}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </Panel>
  )
}

/** The board at a glance — the same six columns, with the same words. */
const COLUMN_TONE: Record<BoardColumnKey, ChipTone> = {
  draft: 'muted', quality_check: 'amber', with_client: 'blue', ready_to_post: 'green', booked: 'blue', posted: 'green', delivered: 'green',
}

/** "Where everything is right now" — the ROLE's own columns, each chip a way
 *  into that column of a board the role has (the owner, 13 Sep 2026: "this
 *  needs fixing for every role, the button pages are wrong"). */
function Pipeline({ pipeline, role, plansInReview }: {
  pipeline: Record<string, number> | undefined
  role: Role | null | undefined
  plansInReview: number
}) {
  const chips = overviewChips(role)
  return (
    <TintCard tone="paper" title="Where everything is right now">
      <div className="flex flex-wrap gap-2">
        {chips.map(c => {
          const n = chipCount(c, pipeline, plansInReview)
          const tone = COLUMN_TONE[c.columns[0] ?? 'draft'] ?? 'surface'
          const chip = <Chip tone={tone}>{c.label} · <span className="tabular-nums">{n}</span></Chip>
          return linkAllowed(role, c.href)
            ? <Link key={c.key} href={c.href} className="rounded-full underline-offset-4 hover:underline">{chip}</Link>
            : <span key={c.key}>{chip}</span>
        })}
      </div>
    </TintCard>
  )
}

/** Where this browser thinks it is. Null when it will not say. */
function browserZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null
  } catch {
    return null
  }
}

export default function OverviewPage() {
  // resolved after mount: on the server there is no viewer to have a zone,
  // and rendering the clock during render would hydrate wrong
  const [viewerTz, setViewerTz] = useState<string | null>(null)
  const [now, setNow] = useState<Date | null>(null)
  const [month, setMonth] = useState<Date | null>(null)
  useEffect(() => {
    setViewerTz(browserZone())
    setNow(new Date())
    setMonth(new Date())
    // ticks so the greeting and the clock stay honest on a page left open
    // a live clock, with seconds (the owner, 13 Sep 2026: "make sure time on
    // the right is live and seconds is there")
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  /**
   * THE OVERVIEW, LIVE.
   *
   * One `/api/overview` call, refetched in full every time anybody anywhere
   * moved anything, used to sit here. The cards now count live rows — an
   * approval lands in "Ready for checking" as the manager clicks it, with no
   * refetch and no reload.
   *
   * The counting itself is NOT reimplemented: `buildOverview` in
   * `app/lib/overview-core.ts` is the route's own shaping, moved out of it,
   * and the route calls the same function on the same shape of rows. The page
   * and the API therefore cannot disagree about what a number means.
   */
  const { me } = useRole()
  const viewer = useMemo(
    () => (me && me.role !== 'client' ? { id: me.id, role: me.role, quality_reviewer: me.quality_reviewer === true } : null), [me])
  // schedulerPostFilter off: the Overview counts a scheduler's whole scoped
  // list and lets each card decide, exactly as its route always did
  const live = useWorkRows(viewer, { schedulerPostFilter: false })
  const enabled = viewer !== null
  const byMe = useMemo(() => ({ team_user_id: me?.id ?? '' }), [me?.id])
  const { rows: pageAccess } = useTable<UserPageAccess & { hidden?: boolean }>(
    'user_page_access', { by: byMe, enabled: enabled && !!me?.id })
  const isManager = viewer?.role === 'account_manager' || viewer?.role === 'super_admin'
  // hidden wins for everyone — a super admin who muted Leads sees none of it
  const leadsRow = pageAccess.find(r => r.href === '/dashboard/leads')
  const mayLeads = isManager && !leadsRow?.hidden
    && (viewer?.role === 'super_admin' || (!!leadsRow && !leadsRow.hidden))
  // Bookings is a grant-only page (page-access-core), so the rail's "Book a
  // shoot" button is drawn only for the people who actually hold it — a
  // button that lands on "this page is not part of your access" is worse
  // than no button.
  const bookingsRow = pageAccess.find(r => r.href === '/dashboard/bookings')
  const mayBook = !!bookingsRow && !bookingsRow.hidden
  // the same 50 the route reads: "8+ total" means "of the 50 newest", and a
  // page counting more than the endpoint does is the two disagreeing
  const { rows: leadRows } = useTable<Lead>(
    'leads', { orderBy: LEADS_NEWEST, limit: LEADS_CAP, enabled: mayLeads })
  // Scheduled posts are what the rail's calendar and today-list are made of,
  // so this is no longer the scheduler's alone. Nothing downstream changes:
  // `buildOverview` reads `entries` only in its scheduler branch, so every
  // role's numbers are exactly what they were.
  const { rows: entryRows } = useTable<ScheduleEntry>('schedule_entries', { enabled })
  /**
   * WHAT EACH ACCOUNT POSTED THIS MONTH — managers only, so nobody else
   * downloads these four tables. They are listened to whole, exactly as the
   * boards listen to theirs (`useWorkTables`); the month is cut on the page,
   * in each client's own zone, by `monthPostsByAccount`.
   */
  const { rows: jobRows } = useTable<PublishJob>('publish_jobs', { enabled: enabled && isManager })
  const { rows: accountRows } = useTable<SocialAccount>('social_accounts', { enabled: enabled && isManager })
  const { rows: analyticRows } = useTable<PostAnalytic>('post_analytics', { enabled: enabled && isManager })

  const data: Overview | null = useMemo(() => {
    if (!me || !viewer || live.loading) return null
    const raw = live.tables.items.rows
    const clientsById = new Map(live.tables.clients.rows.map(c => [c.id, c]))
    const items = live.items as unknown as OverviewItem[]
    // a tagged item off the roster is still theirs to answer
    const have = new Set(items.map(i => i.id))
    const taggedExtraItems = raw
      .filter(r => live.tagged.items.includes(r.id) && !have.has(r.id))
      .map(r => ({
        ...r,
        clients: clientsById.get(r.client_id) ? { name: clientsById.get(r.client_id)!.name } : null,
      })) as unknown as OverviewItem[]
    const taggedShoots = live.tables.batches.rows
      .filter(b => live.tagged.batches.includes(b.id))
      .map(b => ({
        id: b.id,
        title: b.title,
        client_id: b.client_id,
        clients: clientsById.get(b.client_id) ? { name: clientsById.get(b.client_id)!.name } : null,
      }))
    // PLANS WAITING ON THE QUALITY CHECKER (13 Sep 2026): asked of this
    // viewer and not passed yet — one row each, on their Overview
    const shootsToReview = live.tables.batches.rows
      .filter(b => {
        const r = b as unknown as { review_asked_to?: unknown; plan_reviewed_at?: string | null; go_at?: string | null }
        const to = Array.isArray(r.review_asked_to) ? r.review_asked_to.map(String) : []
        return to.includes(me.id) && !r.plan_reviewed_at && !r.go_at && !live.tagged.batches.includes(b.id)
      })
      .map(b => ({
        id: b.id,
        title: b.title,
        client_id: b.client_id,
        clients: clientsById.get(b.client_id) ? { name: clientsById.get(b.client_id)!.name } : null,
        line: 'Review the plan',
      }))
    taggedShoots.push(...shootsToReview)
    // how many clients this person runs — null means every one of them
    const scopedClients = accessibleClientIdsOf(viewer, live.tables.assignments.rows)
    const clientCount = scopedClients === null
      ? live.tables.clients.rows.length
      : live.tables.clients.rows.filter(c => scopedClients.includes(c.id)).length
    // the same lower bound the route used: without it, historical rows fill
    // the window and both scheduler panels go permanently blank
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()
    const itemById = new Map(raw.map(r => [r.id, r]))
    const entries = entryRows
      .filter(e => e.scheduled_at != null && e.scheduled_at >= weekAgo)
      .sort((a, b) => (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? ''))
      .slice(0, 200)
      .map(e => {
        const it = itemById.get(e.item_id)
        const c = it ? clientsById.get(it.client_id) : null
        return {
          ...e,
          content_items: it
            ? {
                id: it.id,
                title: it.title,
                client_id: it.client_id,
                clients: c ? { name: c.name, timezone: c.timezone } : null,
              }
            : null,
        }
      })
    return buildOverview({
      user: { id: me.id, role: me.role, name: me.name },
      items,
      tagged: live.tagged,
      taggedExtraItems,
      taggedShoots,
      clientCount,
      entries: entries as never,
      leads: leadRows,
      mayLeads,
    }) as unknown as Overview
  }, [me, viewer, live, entryRows, leadRows, mayLeads])

  const loading = data === null && live.error === null
  const role = data?.role
  const zone = viewerTz || me?.timezone || DEFAULT_TZ
  const todayKey = now ? dayKeyInZone(now, zone) : null

  /**
   * One row per client account: what went out, what is booked, what did not
   * go out, what was posted by hand, and the month's numbers on top. Scoped
   * with the same `accessibleClientIdsOf` the tiles use, so an account
   * manager sees their clients and a super admin sees every one.
   *
   * `todayKey` is the dependency, not the ticking clock: the month only
   * changes once a day, and re-counting every minute would be work nobody
   * asked for.
   */
  const accountPosts = useMemo(() => {
    if (!viewer || !isManager || live.loading || !todayKey) return null
    const scoped = accessibleClientIdsOf(viewer, live.tables.assignments.rows)
    return monthPostsByAccount({
      now: new Date().toISOString(),
      accounts: accountRows,
      clients: live.tables.clients.rows,
      jobs: jobRows as unknown as MonthJob[],
      byHand: byHandRows(live.tables.items.rows),
      analytics: analyticRows,
      clientIds: scoped,
      defaultTz: DEFAULT_TZ,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, isManager, live.loading, live.tables.assignments.rows, live.tables.clients.rows,
    live.tables.items.rows, jobRows, accountRows, analyticRows, todayKey])


  /** which clients have a channel connected — only a scheduler's tiles ask */
  const [connectedClientIds, setConnectedClientIds] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    if (viewer?.role !== 'scheduler') return
    let cancelled = false
    fetch('/api/social/accounts', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : { accounts: [] }))
      .then((json: { accounts?: { client_id: string | null; active: boolean }[] }) => {
        if (cancelled) return
        setConnectedClientIds(new Set((json.accounts ?? []).filter(a => a.active && a.client_id).map(a => a.client_id as string)))
      })
      .catch(() => { /* the tile then counts every ready card as waiting */ })
    return () => { cancelled = true }
  }, [viewer?.role])

  /**
   * "WHAT IS ON ME TODAY" — one tile per question, per role, every tile a
   * link into the cards it counts (`overviewTiles`, pure and tested). Drawn
   * from the same live rows as everything else on the page.
   */
  /** the posts — every card that is not a shoot plan; what the tiles and the
   *  pipeline strip both count, so they cannot disagree */
  const postCards = useMemo(
    () => (live.items as unknown as BoardViewCard[])
      .filter(c => ((c as { work_kinds?: { slug?: string } | null }).work_kinds?.slug ?? '') !== 'shoot_brief'),
    [live.items])
  /**
   * THE PLAYBOOK'S THREE COUNTED STAGES, per client, this month: produced,
   * delivered, published — against what the month's agreement promised.
   * Read from the activity log and the cards' delivery stamps
   * (`overview-stages-core`), so "delivered" here is the same stamp the card
   * wears. Managers and super admins only; scoped to their clients.
   */
  const { rows: commitmentRows } = useTable<StageCommitment & { id: string }>('monthly_commitments', { enabled: enabled && isManager })
  const stageRows = useMemo(() => {
    if (!viewer || !isManager || live.loading || !todayKey) return null
    const scoped = accessibleClientIdsOf(viewer, live.tables.assignments.rows)
    return monthStages({
      now: new Date().toISOString(),
      items: postCards.map(c => ({ id: c.id, client_id: c.client_id, status: c.status, delivered_at: c.delivered_at ?? null })),
      activity: live.tables.activity.rows,
      clients: live.tables.clients.rows,
      commitments: commitmentRows,
      clientIds: scoped,
      defaultTz: DEFAULT_TZ,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, isManager, live.loading, live.tables.assignments.rows, live.tables.clients.rows,
    live.tables.activity.rows, postCards, commitmentRows, todayKey])
  /** a plan asked for review and not yet passed — the quality checker's queue */
  const planInReview = (b: { review_asked_at?: string | null; plan_reviewed_at?: string | null }) =>
    !!b.review_asked_at && !(b.plan_reviewed_at && String(b.plan_reviewed_at) >= String(b.review_asked_at))
  const plansToReview = useMemo(
    () => (live.batches as unknown as { id: string; title: string; clients?: { name: string } | null; review_asked_at?: string | null; plan_reviewed_at?: string | null }[])
      .filter(planInReview).slice(0, 8),
    [live.batches])
  const plansInReview = plansToReview.length
  /** cards at Quality check, for the quality checker's own list */
  const qualityQueue = useMemo(
    () => (postCards as unknown as ItemLite[]).filter(c => c.status === 'quality_check').slice(0, 8),
    [postCards])
  const postPipeline = useMemo(() => {
    const out: Record<string, number> = {}
    for (const c of postCards) out[String(c.status)] = (out[String(c.status)] ?? 0) + 1
    return out
  }, [postCards])
  const tiles = useMemo(() => {
    if (!viewer || live.loading || !todayKey) return null
    const cards = postCards
    const postingToday = new Set(
      entryRows.filter(e => e.scheduled_at && dayKeyInZone(e.scheduled_at, zone) === todayKey).map(e => e.item_id))
    const scoped = accessibleClientIdsOf(viewer, live.tables.assignments.rows)
    const clientCount = scoped === null
      ? live.tables.clients.rows.length
      : live.tables.clients.rows.filter(c => scoped.includes(c.id)).length
    const weekAgo = Date.now() - 7 * 86_400_000
    const leadsWeek = leadRows.filter(l => new Date(l.created_at).getTime() >= weekAgo).length
    const out: OverviewTile[] = overviewTiles({
      viewer, cards, today: todayKey, postingToday, connectedClientIds, clientCount, leadsWeek, mayLeads,
    })
    // SHOOT PLANS LATE (the playbook's one-week rule, 11 Sep 2026): a shoot
    // under seven days out whose plan has not been shared. Shown to the
    // people who can fix it — managers, super admins and general users —
    // with the count even when it is zero, so "no plan is late" is said
    // rather than left to be inferred from a missing tile.
    if (viewer.role === 'super_admin' || viewer.role === 'account_manager' || viewer.role === 'general') {
      const late = live.batches.filter(b => briefIsLate(b as unknown as SopShoot, todayKey)).length
      out.push({
        key: 'shoots-late',
        title: 'Shoot plans late',
        tone: late > 0 ? 'amber' : 'paper',
        href: '/dashboard/production?view=shoots',
        actionLabel: 'Open the shoots',
        stats: [{ value: late, label: 'not shared 7 days before the shoot' }],
      })
    }
    return out
  }, [viewer, live.loading, live.batches, postCards, live.tables.assignments.rows, live.tables.clients.rows, entryRows, leadRows, mayLeads, connectedClientIds, todayKey, zone])
  /* MiniCalendar reads a Date with the BROWSER's own calendar. This hands it
     one whose local year/month/day are the viewer zone's today, so the filled
     cell and the markers can never disagree about which day it is. */
  const todayDate = useMemo(() => {
    if (!todayKey) return undefined
    const [y, m, d] = todayKey.split('-').map(Number)
    return new Date(y, m - 1, d)
  }, [todayKey])

  /* ── the rail: the shoots, posts and client reviews the page already holds ── */

  const clientNameOf = useMemo(
    () => new Map(live.tables.clients.rows.map(c => [c.id, { name: c.name, tz: c.timezone }])),
    [live.tables.clients.rows])

  /** every day this month with something on it — shoots amber, posts blue,
   *  client reviews green */
  const markers: Marker[] = useMemo(() => {
    const out: Marker[] = []
    for (const b of live.batches) {
      const d = b.shoot_date ? dayKeyInZone(b.shoot_date, zone) : null
      if (d) out.push({ date: d, kind: 'shoot' })
    }
    const itemById = new Map(live.items.map(i => [i.id, i]))
    for (const e of entryRows) {
      if (!e.scheduled_at) continue
      const it = itemById.get(e.item_id)
      if (!it) continue
      const d = dayKeyInZone(e.scheduled_at, zone)
      if (d) out.push({ date: d, kind: 'post' })
    }
    for (const i of live.items) {
      if (!i.due_date) continue
      if (!['client_review', 'client_changes_requested'].includes(i.status)) continue
      out.push({ date: i.due_date, kind: 'review' })
    }
    return out
  }, [live.batches, live.items, entryRows, zone])

  /** today, in order — the same rows, filtered to this one day */
  const todayItems: TimelineItem[] = useMemo(() => {
    if (!todayKey) return []
    const rows: (TimelineItem & { at: string })[] = []
    for (const b of live.batches) {
      if (!b.shoot_date || dayKeyInZone(b.shoot_date, zone) !== todayKey) continue
      const timed = String(b.shoot_date).includes('T')
      rows.push({
        // the sort key is WALL time in the viewer's zone, never the raw stamp:
        // an all-day shoot's "00:00" and a 9 am Melbourne post's UTC "T23:00"
        // sort the wrong way round as plain strings
        at: timed ? (toZonedInput(b.shoot_date, zone) || `${todayKey}T00:00`) : `${todayKey}T00:00`,
        time: timed ? (formatInZone(b.shoot_date, zone, 'time') ?? '') : 'All day',
        title: `Shoot · ${b.clients?.name ?? 'a client'}`,
        detail: [b.title, b.location].filter(Boolean).join(' · ') || undefined,
        tone: 'amber',
        href: `/dashboard/production/shoots/${b.id}`,
      })
    }
    const itemById = new Map(live.items.map(i => [i.id, i]))
    for (const e of entryRows) {
      if (!e.scheduled_at || dayKeyInZone(e.scheduled_at, zone) !== todayKey) continue
      const it = itemById.get(e.item_id)
      if (!it) continue
      rows.push({
        at: toZonedInput(e.scheduled_at, zone) || `${todayKey}T00:00`,
        time: formatInZone(e.scheduled_at, zone, 'time') ?? '',
        title: `Post goes live · ${clientNameOf.get(it.client_id)?.name ?? 'a client'}`,
        detail: [it.title, platformName(e.platform)].filter(Boolean).join(' · '),
        tone: 'blue',
        href: cardHref(role as Role | null, it),
      })
    }
    for (const i of live.items) {
      if (i.due_date !== todayKey) continue
      if (['published', 'scheduled'].includes(i.status)) continue
      const review = ['client_review', 'client_changes_requested'].includes(i.status)
      rows.push({
        at: `${todayKey}T23:59`,
        time: 'Due',
        title: `${review ? 'Client review' : 'Due today'} · ${i.clients?.name ?? 'a client'}`,
        detail: i.title,
        tone: review ? 'green' : 'amber',
        href: cardHref(role as Role | null, i),
      })
    }
    return rows
      .sort((a, b) => a.at.localeCompare(b.at))
      .map(r => ({ time: r.time, title: r.title, detail: r.detail, tone: r.tone, href: r.href }))
  }, [live.batches, live.items, entryRows, clientNameOf, todayKey, zone, role])

  /* ── the heading ── */

  const firstName = (me?.name || '').trim().split(/\s+/)[0]
  const hello = now ? greetingInZone(now, zone) : null
  const title = hello ? (firstName ? `${hello}, ${firstName}` : hello) : 'Overview'

  /** the one plain sentence, from the numbers already on this page */
  const summary = useMemo(() => {
    if (!data) return undefined
    if (data.editor) {
      const e = data.editor
      return `${plural(e.due_soon_count ?? e.due_soon.length, 'card')} due this week, `
        + `${e.revisions_needed} being changed, and ${e.in_internal_review} with the account manager.`
    }
    if (data.scheduler) {
      const s = data.scheduler
      return `${plural(s.to_schedule, 'card')} ready to post, `
        + `${plural(s.upcoming_count ?? s.upcoming.length, 'post')} going out in the next 7 days, `
        + `and ${s.published_week} published this week.`
    }
    if (data.manager) {
      const m = data.manager
      const leads = m.latest_leads ? `, and ${plural(m.leads_week ?? 0, 'new lead')} came in this week` : ''
      return `${plural(m.awaiting_internal_review, 'card')} waiting on you, `
        + `${m.awaiting_client} with ${m.awaiting_client === 1 ? 'a client' : 'clients'}${leads}.`
    }
    return undefined
  }, [data])

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title={title} summary={summary} />

      {/* a listener that could not read is a failure, not a page of zeros —
          every number below is drawn from those rows, and showing "0 waiting
          on you" because the connection dropped is a lie with a number on it */}
      {live.error && (
        <LoadFailed what="your dashboard" detail={live.error}
          onRetry={() => window.location.reload()} />
      )}

      {/* the only onboarding in the product — three steps for this role, each
          a real link, dismissed per person and per role */}
      {!loading && !live.error && <GettingStarted role={(role ?? null) as Role | null} />}
      {/* nobody flagged as the quality reviewer: every check comes to the
          super admins until one is set (11 Sep 2026) */}
      {!loading && <NoReviewerBanner me={me} />}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_336px]">
        {/* ── the page ── */}
        <div className="flex min-w-0 flex-col gap-6">

          {/* one neutral skeleton until the role is known — branching while
              `loading` flashed the editor layout at every other role first */}
          {loading && (
            <div className="grid gap-4 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-40 w-full rounded-card" />)}
            </div>
          )}

          {/* ---- what is on me today: one tile per question, per role ----
              editor: assigned, due, came back · scheduler: ready, going out
              today, waiting on an account · account manager: their clients,
              what needs their decision, what is with clients · super admin:
              the agency at a glance, plus Leads. Every tile links into the
              cards it counts — a number is never shown without a way to act. */}
          {!loading && tiles && (
            <div className="grid gap-4 sm:grid-cols-2">
              {tiles.map(t => (
                <TintCard key={t.key} tone={t.tone} title={t.title}
                  action={{ label: t.actionLabel, href: t.href }}
                  className={t.stats.length > 3 ? 'sm:col-span-2' : undefined}>
                  <div className="flex flex-wrap gap-7">
                    {t.stats.map(s => <Stat key={s.label} value={s.value} label={s.label} />)}
                  </div>
                </TintCard>
              ))}
            </div>
          )}

          {/* somebody tagged you and it is not done — every role, whatever the
              client. The tag is the assignment; this is where it is answered. */}
          {!loading && data?.waiting_on_you
            && (data.waiting_on_you.items.length + data.waiting_on_you.shoots.length) > 0 && (
            <Section title="Waiting on you"
              aside={<span className="ml-auto text-[13px] text-muted-foreground">
                Someone tagged you. Open it and mark the note done when you have answered.
              </span>}>
              <div className="flex flex-col gap-2">
                {data.waiting_on_you.items.map(i => (
                  <WorkRow key={i.id} tone="amber"
                    href={cardHref(role as Role | null, i)}
                    title={i.clients?.name ? `${i.clients.name} · ${i.title}` : i.title}
                    detail={statusLabel(i)} chip="Answer this" />
                ))}
                {data.waiting_on_you.shoots.map(s => (
                  <WorkRow key={s.id} tone="amber"
                    href={shootHref(s.id)}
                    title={s.clients?.name ? `${s.clients.name} · ${s.title}` : s.title}
                    detail={s.line ?? 'Shoot'} chip={s.line ? 'Open the plan' : 'Answer this'} />
                ))}
              </div>
            </Section>
          )}

          {/* Seven identical grey ghost links and no cue which to press. The one
              thing a manager should do first now says so, and says how many. */}
          {!loading && isManager && (data?.manager?.needs_review?.length ?? 0) > 0 && (
            <Button size="sm" className="min-h-11 w-fit" asChild>
              <Link href="/dashboard/scheduler?show=decide">
                Check {data!.manager!.needs_review.length} card{data!.manager!.needs_review.length === 1 ? '' : 's'} waiting on you
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          )}

          {/* ---- the lists, per role ---- */}
          {!loading && (role === 'editor' || role === 'general') && data?.editor && (
            <>
              <Section title="Assigned to you" action={actionFor(role as Role | null, 'Open the board', EDITOR_BOARD)}>
                <ItemRows items={data.editor.needs_action} todayKey={todayKey} role={role as Role | null}
                  empty="Nothing waiting on you — everything is being checked." />
              </Section>
              <Section title="Due soon" action={actionFor(role as Role | null, 'Open the board', EDITOR_BOARD)}>
                <ItemRows items={data.editor.due_soon} todayKey={todayKey} role={role as Role | null}
                  empty="Nothing due in the next 7 days." />
              </Section>
              {/* the open pool: work nobody holds, one click from being yours */}
              {data.editor.unassigned && (
                <Section title="Nobody has taken these yet" action={actionFor(role as Role | null, 'Open the board', EDITOR_BOARD)}>
                  <ItemRows items={data.editor.unassigned} todayKey={todayKey} role={role as Role | null}
                    empty="Nothing is going spare." />
                </Section>
              )}
            </>
          )}

          {role === 'scheduler' && data?.scheduler && (
            <>
              <Section title="Ready to post" action={actionFor(role as Role | null, 'Open the board', boardHref('scheduler', { column: 'ready_to_post' }))}>
                <ItemRows items={data.scheduler.queue} todayKey={todayKey} role={role as Role | null}
                  empty="Nothing waiting — a card lands here the moment it is signed off." />
              </Section>
              <Section title="Going out next" action={actionFor(role as Role | null, 'Calendar', CALENDAR_PAGE)}>
                {data.scheduler.upcoming.length === 0 ? (
                  <p className="rounded-inner border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted-foreground">
                    Nothing scheduled for the next 7 days.
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {data.scheduler.upcoming.map(e => {
                      // when it reaches the AUDIENCE — this strip mixes clients,
                      // so the zone comes from the row, not the page
                      const tz = e.content_items?.clients?.timezone || DEFAULT_TZ
                      const when = e.scheduled_at ? formatInZone(e.scheduled_at, tz, 'short') : null
                      // "= 1:00 pm your time" for a scheduler in Manila — the
                      // one fact a phone user most needs, never a hover
                      const mine = viewerHint(e.scheduled_at, tz, viewerTz)
                      return (
                        <WorkRow key={e.id} tone="blue"
                          href={cardHref(role as Role | null, { id: e.item_id, status: (e.content_items as { status?: string } | null)?.status ?? 'scheduled' })}
                          title={e.content_items?.clients?.name
                            ? `${e.content_items.clients.name} · ${e.content_items?.title ?? '—'}`
                            : (e.content_items?.title ?? '—')}
                          detail={[platformName(e.platform), mine].filter(Boolean).join(' · ')}
                          chip={when ?? undefined} />
                      )
                    })}
                  </div>
                )}
              </Section>
            </>
          )}

          {/* THE QUALITY CHECKER'S DESK (13 Sep 2026): what waits on them —
              cards at Quality check, and plans asked of them — nothing
              about deciding, booking or leads */}
          {!loading && role === 'quality_checker' && (
            <>
              <Section title="Waiting on your quality check" action={actionFor(role as Role | null, 'Open the board', `${POST_APPROVAL_BOARD}?column=quality_check`)}>
                <ItemRows items={qualityQueue} todayKey={todayKey} role={role as Role | null}
                  empty="Nothing waiting on a quality check." />
              </Section>
              <Section title="Plans to review" action={actionFor(role as Role | null, 'Open the shoots', SHOOTS_PAGE)}>
                {plansToReview.length === 0 ? (
                  <p className="rounded-inner border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted-foreground">
                    No plan is waiting on you.
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {plansToReview.map(b => (
                      <WorkRow key={b.id} tone="amber" href={shootHref(b.id)}
                        title={b.clients?.name ? `${b.clients.name} · ${b.title}` : b.title}
                        detail="Review the plan — pass it, or send it back with a note" chip="Open the plan" />
                    ))}
                  </div>
                )}
              </Section>
            </>
          )}

          {data?.manager && isManager && (
            <>
              {(data.manager.my_tasks?.length ?? 0) > 0 && (
                <Section title="Assigned to you" action={actionFor(role as Role | null, 'Open the board', EDITOR_BOARD)}>
                  <ItemRows items={data.manager.my_tasks} todayKey={todayKey} role={role as Role | null} empty="" />
                </Section>
              )}
              {/* the three stages whose turn is a MANAGER's — the same
                  population the stat above it counts */}
              <Section title="Waiting on your sign-off" action={actionFor(role as Role | null, 'Open the board', EDITOR_BOARD)}>
                <ItemRows items={data.manager.needs_review} todayKey={todayKey} role={role as Role | null}
                  empty="Nothing is waiting on you right now." />
              </Section>
            </>
          )}
        </div>

        {/* ── the rail: this month, and today ── */}
        <aside className="flex min-w-0 flex-col gap-4">
          {month === null
            ? <Skeleton className="h-[360px] w-full rounded-card" />
            : (
              <MiniCalendar
                month={month}
                markers={markers}
                today={todayDate}
                onMonthChange={setMonth}
                action={mayBook ? { label: 'Book a shoot', href: '/dashboard/bookings' } : undefined}
              />
            )}

          <Panel
            title={now ? `Today, ${now.toLocaleDateString('en-AU', { timeZone: zone, day: 'numeric', month: 'long' })}` : 'Today'}
            right={now && (
              <span className="shrink-0 text-[12px] font-semibold text-muted-foreground">
                {now.toLocaleTimeString('en-AU', { timeZone: zone, hour: 'numeric', minute: '2-digit', second: '2-digit' })} · {zoneLabel(zone)}
              </span>
            )}
          >
            <Timeline items={todayItems} empty="Nothing on today." />
          </Panel>
        </aside>
      </div>

      {/* ── the wide blocks, under both columns ── */}
      {/* the SAME cards the tiles above count — posts, not shoot plans. The
          strip used to read the API's pipeline (every item, shoot plans
          included) while "The agency at a glance" left shoot plans out, so
          one card said "0 draft" and the other "Draft · 4" (9 Sep 2026). */}
      {!loading && role && <Pipeline pipeline={postPipeline} role={role as Role} plansInReview={plansInReview} />}

      {data?.manager && isManager && (
        <>
          {/* the ledger first, then what each account actually posted */}
          <PostsThisMonth rows={accountPosts} />
          <StagesThisMonth rows={stageRows} clients={live.tables.clients.rows} />
          <div className="grid gap-6 lg:grid-cols-2">
            {/* what is waiting on YOU, beside who else is behind */}
            <TeamLoadCard />
            {data.manager.latest_leads && (
              <Panel
                title="Latest leads"
                right={
                  <Link href="/dashboard/leads"
                    className="-my-3 inline-flex min-h-11 shrink-0 items-center gap-1 text-[13px] font-semibold underline-offset-4 hover:underline">
                    View all <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.8} />
                  </Link>
                }
              >
                {data.manager.latest_leads.length === 0 ? (
                  <p className="py-6 text-center text-[13px] text-muted-foreground">No leads yet.</p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {data.manager.latest_leads.map(l => (
                      <div key={l.id} className="flex items-baseline gap-3 rounded-inner px-3 py-2">
                        <span className="text-[15px] font-semibold">{l.fname} {l.lname}</span>
                        <span className="truncate text-[13px] text-muted-foreground">{l.biz}</span>
                        <span className="ml-auto shrink-0 text-[12px] text-muted-foreground">
                          {new Date(l.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
            )}
          </div>
        </>
      )}
    </div>
  )
}
