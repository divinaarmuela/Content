'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  ArrowRight, CalendarClock, CheckCircle2, ClipboardList, Clock,
  ChevronDown, ChevronLeft, ChevronRight,
} from 'lucide-react'
import GettingStarted from './GettingStarted'
import { LoadFailed } from './NotSetUp'
import type { Role } from '../lib/identity-core'
import TeamLoadCard from './TeamLoadCard'
import PageTitle from './ui/PageTitle'
import TintCard from './ui/TintCard'
import Stat from './ui/Stat'
import Chip, { type ChipTone } from './ui/Chip'
import MiniCalendar, { type Marker } from './ui/MiniCalendar'
import Timeline, { type TimelineItem } from './ui/Timeline'
import {
  DEFAULT_TZ, dayKeyInZone, formatInZone, greetingInZone, toZonedInput,
  viewerHint, zoneLabel,
} from '../lib/timezone-core'
import { useTable } from '@/lib/db-client'
import type { Lead, ScheduleEntry, UserPageAccess } from '@/lib/db-types'
import { useRole } from './useRole'
import { useWorkRows } from './useLiveWork'
import { buildOverview, LEADS_CAP, type OverviewItem } from '../lib/overview-core'
import { accessibleClientIdsOf } from '../lib/scope-client'
import { overviewTiles, type BoardViewCard } from '../lib/board-view-core'
import { STATUS_LABELS, type ItemStatus } from '../lib/workflow-core'
import { itemStatusLabel } from '../lib/brief-task-core'
import { compactCount } from '../lib/post-analytics-core'
import {
  expandLine, NO_AGREEMENT_LINE,
  type MonthClientRow, type MonthStatus,
} from '../lib/overview-month-core'

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
  shoots: { id: string; title: string; clients: { name: string } | null }[]
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

/** Plain words, and a shoot brief's own words when it is one. */
const statusLabel = (i: ItemLite) =>
  itemStatusLabel(i.work_kinds?.slug, i.status, STATUS_LABELS[i.status])

/** "1 item" / "4 items" — the summary sentence reads as English or not at all. */
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
function ItemRows({ items, empty, todayKey }: {
  items: ItemLite[] | undefined
  empty: string
  todayKey: string | null
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
        return (
          <WorkRow key={i.id}
            href={`/dashboard/production/${i.id}`}
            tone={tone}
            title={i.clients?.name ? `${i.clients.name} · ${i.title}` : i.title}
            /* the status is the detail line; the chip only ever adds a SECOND
               fact — printing "Being revised" twice on one row said nothing
               twice */
            detail={statusLabel(i)}
            chip={due ? (i.due_date === todayKey ? 'Due today' : 'Overdue') : undefined}
          />
        )
      })}
    </div>
  )
}

type AtRiskLine = { type: string; label: string; quota: number; delivered: number; pace: string; in_production?: number; approved?: number; scheduled?: number; posted?: number }
type AtRiskClient = { id: string; name: string; has_agreement: boolean; worst: string; lines: AtRiskLine[] }

const PACE_DOT: Record<string, string> = {
  behind: 'bg-accent-red', tight: 'bg-accent-amber', on_track: 'bg-accent-green', met: 'bg-accent-green',
}

const MONTH_CHIP: Record<MonthStatus, ChipTone> = {
  short: 'red', at_risk: 'amber', on_track: 'blue', met: 'green',
}

const chipWords = (r: MonthClientRow) => (r.status === 'met' ? 'Met ✓' : r.status_label)

/** A client's last post, on that client's own calendar. */
const shortDate = (iso: string, tz?: string | null) =>
  formatInZone(iso, tz || DEFAULT_TZ, 'date') ?? ''

/** The per-type promise: "Reels 2/4 · Graphics 3/3", short lines coloured. */
function TypeChips({ row }: { row: MonthClientRow }) {
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1">
      {row.lines.map(l => (
        <span key={l.type}
          className={`text-[12px] font-medium tabular-nums ${
            l.posted >= l.promised ? 'text-muted-foreground'
              : l.pace === 'behind' ? 'text-accent-red'
                : l.pace === 'tight' ? 'text-accent-amber'
                  : 'text-muted-foreground'
          }`}>
          {expandLine(l)}
        </span>
      ))}
    </span>
  )
}

/**
 * "This month across clients" — the owner's one screen.
 *
 * Every client the caller can see, in triage order: what they were promised,
 * what actually went live, what is still moving, and what the month has done
 * in views. The Agreement gaps card below is the alert — this is the ledger,
 * so a client who is perfectly fine still appears, which is the whole point of
 * asking "did everyone get their month?".
 *
 * Under 768px the table becomes cards: the same eight facts, stacked, because
 * eight columns on a phone is a horizontal scroll nobody reads.
 */
function MonthAcrossClients() {
  const router = useRouter()
  const [back, setBack] = useState(0)                 // whole months before now
  const [rows, setRows] = useState<MonthClientRow[] | null>(null)
  // a failed fetch used to render "No active clients to report on." — the app
  // telling a manager their agency has no clients because a request 500'd
  const [failed, setFailed] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  const now = new Date()
  const target = new Date(now.getFullYear(), now.getMonth() - back, 1)
  const month = target.getMonth() + 1
  const year = target.getFullYear()

  useEffect(() => {
    let live = true
    setRows(null); setFailed(null)
    fetch(`/api/overview/month?month=${month}&year=${year}`)
      .then(async r => {
        if (!r.ok) throw new Error(`${r.status}`)
        return r.json()
      })
      .then(j => { if (live) setRows(j.clients ?? []) })
      .catch(e => {
        console.error('[overview month] load failed', e)
        if (live) setFailed(e instanceof Error ? e.message : 'unknown')
      })
    return () => { live = false }
  }, [month, year, attempt])

  const monthName = target.toLocaleDateString('en-AU', { month: 'long', year: back === 0 ? undefined : 'numeric' })
  const openClient = (id: string) => router.push(`/dashboard/clients/${id}`)

  return (
    <Panel
      title="This month across clients"
      right={
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" aria-label="Previous month"
            className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-foreground/[0.06]"
            onClick={() => setBack(b => Math.min(b + 1, 24))}>
            <ChevronLeft className="h-[18px] w-[18px]" strokeWidth={1.8} />
          </button>
          <span className="min-w-[6rem] text-center text-[13px] font-semibold">{monthName}</span>
          <button type="button" aria-label="Next month" disabled={back === 0}
            className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-foreground/[0.06] disabled:opacity-40"
            onClick={() => setBack(b => Math.max(0, b - 1))}>
            <ChevronRight className="h-[18px] w-[18px]" strokeWidth={1.8} />
          </button>
        </div>
      }
    >
      {failed
        ? <LoadFailed what="this month's numbers" detail={failed} onRetry={() => setAttempt(a => a + 1)} />
        : rows === null && <Skeleton className="h-40 w-full rounded-inner" />}
      {!failed && rows !== null && rows.length === 0 && (
        <p className="py-6 text-center text-[13px] text-muted-foreground">
          No active clients to report on.
        </p>
      )}

      {/* ---- 768px and up: the table ---- */}
      {rows !== null && rows.length > 0 && (
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="border-b border-border text-left">
                {['Client', 'Promised', 'Posted', 'Scheduled', 'In production', 'Status', 'Last post', 'Views'].map((h, i) => (
                  <th key={h} className={`py-2 text-[12px] font-semibold text-muted-foreground ${i > 0 ? 'px-3' : 'pr-3'}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <MonthTableRow key={r.id} row={r}
                  expanded={open === r.id}
                  onToggle={() => setOpen(o => (o === r.id ? null : r.id))}
                  onOpen={() => openClient(r.id)} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ---- under 768px: the same eight facts as cards ---- */}
      {rows !== null && rows.length > 0 && (
        <div className="flex flex-col gap-2 md:hidden">
          {rows.map(r => (r.has_agreement ? (
            <button key={r.id} type="button" onClick={() => openClient(r.id)}
              className="w-full rounded-inner border border-border p-3.5 text-left hover:bg-foreground/[0.04]">
              <div className="flex items-center gap-2">
                <span className="min-w-0 truncate text-[15px] font-semibold">{r.name}</span>
                <Chip tone={MONTH_CHIP[r.status]} className="ml-auto shrink-0">{chipWords(r)}</Chip>
              </div>
              <div className="mt-2 grid grid-cols-4 gap-2 tabular-nums">
                {[
                  ['Promised', r.promised], ['Posted', r.posted],
                  ['Sched.', r.scheduled], ['In prod.', r.in_production],
                ].map(([label, v]) => (
                  <div key={String(label)}>
                    <p className="text-[12px] text-muted-foreground">{label}</p>
                    <p className="text-[15px] font-semibold">{v}</p>
                  </div>
                ))}
              </div>
              <div className="mt-2"><TypeChips row={r} /></div>
              <p className="mt-2 text-[12px] text-muted-foreground">
                {r.last_post ? `Last post ${shortDate(r.last_post.at, r.tz)}` : 'No posts yet'}
                {' · '}{r.views === null ? '—' : `${compactCount(r.views)} views`}
              </p>
            </button>
          ) : (
            <Link key={r.id} href={`/dashboard/clients/${r.id}/agreement`}
              className="flex items-center gap-2 rounded-inner border border-dashed border-border p-3.5 text-[14px] text-muted-foreground hover:bg-foreground/[0.04]">
              <span className="min-w-0 truncate font-medium">{r.name}</span>
              <span className="ml-auto shrink-0 text-[13px]">{NO_AGREEMENT_LINE} →</span>
            </Link>
          )))}
        </div>
      )}
    </Panel>
  )
}

function MonthTableRow({ row, expanded, onToggle, onOpen }: {
  row: MonthClientRow; expanded: boolean; onToggle: () => void; onOpen: () => void
}) {
  // no agreement on file: one muted row that is a to-do, not a measurement
  if (!row.has_agreement) {
    return (
      <tr className="border-b border-border last:border-0">
        <td className="py-2 pr-3 text-muted-foreground">{row.name}</td>
        <td colSpan={7} className="px-3 py-2">
          <Link href={`/dashboard/clients/${row.id}/agreement`}
            className="text-[13px] text-muted-foreground underline-offset-4 hover:underline">
            {NO_AGREEMENT_LINE} →
          </Link>
        </td>
      </tr>
    )
  }
  const num = 'px-3 py-2 tabular-nums'
  return (
    <>
      <tr onClick={onOpen}
        className="cursor-pointer border-b border-border hover:bg-foreground/[0.04]">
        <td className="py-2 pr-3">
          <span className="flex items-center gap-1.5">
            <button type="button" aria-label={expanded ? 'Hide types' : 'Show types'}
              aria-expanded={expanded}
              onClick={e => { e.stopPropagation(); onToggle() }}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground">
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? '' : '-rotate-90'}`} />
            </button>
            <span className="truncate font-medium">{row.name}</span>
          </span>
        </td>
        {/* the per-type breakdown is the chevron at the start of the row —
            one tap, on any device, not a hover */}
        <td className={`${num} font-semibold`}>{row.promised}</td>
        <td className={`${num} font-semibold`}>{row.posted}</td>
        <td className={`${num} text-muted-foreground`}>{row.scheduled}</td>
        <td className={`${num} text-muted-foreground`}>{row.in_production}</td>
        <td className="px-3 py-2">
          <Chip tone={MONTH_CHIP[row.status]} className="shrink-0">{chipWords(row)}</Chip>
        </td>
        <td className="px-3 py-2 text-[13px] text-muted-foreground">
          {row.last_post
            ? (row.last_post.item_id
                ? <Link href={`/dashboard/production/${row.last_post.item_id}`} onClick={e => e.stopPropagation()}
                    className="underline-offset-4 hover:underline">{shortDate(row.last_post.at, row.tz)}</Link>
                : shortDate(row.last_post.at, row.tz))
            : <span className="text-foreground/30">—</span>}
        </td>
        <td className={`${num} text-muted-foreground`}>
          {row.views === null ? <span className="text-foreground/30">—</span> : compactCount(row.views)}
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-border bg-foreground/[0.03]">
          <td />
          <td colSpan={7} className="px-3 py-2"><TypeChips row={row} /></td>
        </tr>
      )}
    </>
  )
}

/** Cross-client "who's behind this month" — pull becomes push. */
function AtRiskThisMonth() {
  const [rows, setRows] = useState<AtRiskClient[] | null>(null)
  useEffect(() => {
    fetch('/api/production/at-risk')
      .then(r => (r.ok ? r.json() : { clients: [] }))
      .then(j => setRows(j.clients ?? []))
      .catch(() => setRows([]))
  }, [])
  if (rows === null) return <Skeleton className="h-24 w-full rounded-card" />
  // every client still OWING something this month — not only the ones behind
  // pace. The dot carries urgency; the numbers carry what's left to deliver.
  const owing = rows.filter(c => c.has_agreement && c.lines.some(l => l.delivered < l.quota))
  return (
    <Panel
      title="Agreement gaps this month"
      /* the table above is the ledger — every client, met or not. This card
         is the alert: only what is still owed, and only where. Saying so
         stops the two reading as the same list twice. */
      right={<span className="shrink-0 text-[13px] text-muted-foreground">Only what’s still owed</span>}
    >
      {owing.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-muted-foreground">
          Every agreement is fully delivered this month. Nice.
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {owing.map(c => {
            const short = c.lines.filter(l => l.delivered < l.quota)
            // what is still moving towards the gap — this sat in a hover-only
            // title= per chip, which is where a phone never looks
            const moving = short.reduce((acc, l) => ({
              scheduled: acc.scheduled + (l.scheduled ?? 0),
              approved: acc.approved + (l.approved ?? 0),
              in_production: acc.in_production + (l.in_production ?? 0),
            }), { scheduled: 0, approved: 0, in_production: 0 })
            const movingWords = [
              moving.scheduled > 0 ? `${moving.scheduled} scheduled` : null,
              moving.approved > 0 ? `${moving.approved} approved` : null,
              moving.in_production > 0 ? `${moving.in_production} in production` : null,
            ].filter(Boolean).join(' · ')
            return (
              <Link key={c.id} href={`/dashboard/clients/${c.id}/agreement`}
                className="flex flex-col gap-0.5 rounded-inner px-3 py-2.5 hover:bg-foreground/[0.04]">
                <span className="flex items-center gap-3">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${PACE_DOT[c.worst] ?? 'bg-foreground/40'}`} />
                  <span className="min-w-0 truncate text-[15px] font-semibold">{c.name}</span>
                  <span className="ml-auto flex flex-wrap justify-end gap-1.5">
                    {short.map(l => (
                      <span key={l.type}
                        className={`text-[12px] font-medium tabular-nums ${
                          l.pace === 'behind' ? 'text-accent-red'
                            : l.pace === 'tight' ? 'text-accent-amber'
                              : 'text-muted-foreground'
                        }`}>
                        {l.label} {l.delivered}/{l.quota}
                      </span>
                    ))}
                  </span>
                </span>
                <span className="pl-5 text-[12px] text-muted-foreground">
                  {movingWords ? `On the way: ${movingWords}` : 'Nothing in the pipeline yet for what is still owed'}
                </span>
              </Link>
            )
          })}
        </div>
      )}
    </Panel>
  )
}

/** The production funnel at a glance — draft → review → approval → published. */
const STAGES: { key: string; label: string; tone: ChipTone }[] = [
  // the same words the board uses — a stage is called one thing everywhere
  { key: 'draft_uploaded', label: STATUS_LABELS.draft_uploaded, tone: 'muted' },
  { key: 'internal_review', label: STATUS_LABELS.internal_review, tone: 'blue' },
  { key: 'revision_required', label: STATUS_LABELS.revision_required, tone: 'amber' },
  { key: 'client_review', label: STATUS_LABELS.client_review, tone: 'blue' },
  { key: 'approved_for_scheduling', label: STATUS_LABELS.approved_for_scheduling, tone: 'green' },
  { key: 'scheduled', label: STATUS_LABELS.scheduled, tone: 'blue' },
  { key: 'published', label: STATUS_LABELS.published, tone: 'green' },
]

function Pipeline({ pipeline }: { pipeline: Record<string, number> | undefined }) {
  return (
    <TintCard tone="paper" title="Where everything is right now">
      <div className="flex flex-wrap gap-2">
        {STAGES.map(s => (
          <Chip key={s.key} tone={s.tone}>
            {s.label} · <span className="tabular-nums">{pipeline?.[s.key] ?? 0}</span>
          </Chip>
        ))}
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
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  /**
   * THE OVERVIEW, LIVE.
   *
   * One `/api/overview` call, refetched in full every time anybody anywhere
   * moved anything, used to sit here. The cards now count live rows — an
   * approval lands in "Ready for review" as the manager clicks it, with no
   * refetch and no reload.
   *
   * The counting itself is NOT reimplemented: `buildOverview` in
   * `app/lib/overview-core.ts` is the route's own shaping, moved out of it,
   * and the route calls the same function on the same shape of rows. The page
   * and the API therefore cannot disagree about what a number means.
   */
  const { me } = useRole()
  const viewer = useMemo(
    () => (me && me.role !== 'client' ? { id: me.id, role: me.role } : null), [me])
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
  const tiles = useMemo(() => {
    if (!viewer || live.loading || !todayKey) return null
    const cards = (live.items as unknown as BoardViewCard[])
      .filter(c => ((c as { work_kinds?: { slug?: string } | null }).work_kinds?.slug ?? '') !== 'shoot_brief')
    const postingToday = new Set(
      entryRows.filter(e => e.scheduled_at && dayKeyInZone(e.scheduled_at, zone) === todayKey).map(e => e.item_id))
    const scoped = accessibleClientIdsOf(viewer, live.tables.assignments.rows)
    const clientCount = scoped === null
      ? live.tables.clients.rows.length
      : live.tables.clients.rows.filter(c => scoped.includes(c.id)).length
    const weekAgo = Date.now() - 7 * 86_400_000
    const leadsWeek = leadRows.filter(l => new Date(l.created_at).getTime() >= weekAgo).length
    return overviewTiles({
      viewer, cards, today: todayKey, postingToday, connectedClientIds, clientCount, leadsWeek, mayLeads,
    })
  }, [viewer, live.loading, live.items, live.tables.assignments.rows, live.tables.clients.rows, entryRows, leadRows, mayLeads, connectedClientIds, todayKey, zone])
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
        href: `/dashboard/production/${it.id}`,
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
        href: `/dashboard/production/${i.id}`,
      })
    }
    return rows
      .sort((a, b) => a.at.localeCompare(b.at))
      .map(r => ({ time: r.time, title: r.title, detail: r.detail, tone: r.tone, href: r.href }))
  }, [live.batches, live.items, entryRows, clientNameOf, todayKey, zone])

  /* ── the heading ── */

  const firstName = (me?.name || '').trim().split(/\s+/)[0]
  const hello = now ? greetingInZone(now, zone) : null
  const title = hello ? (firstName ? `${hello}, ${firstName}` : hello) : 'Overview'

  /** the one plain sentence, from the numbers already on this page */
  const summary = useMemo(() => {
    if (!data) return undefined
    if (data.editor) {
      const e = data.editor
      return `${plural(e.due_soon_count ?? e.due_soon.length, 'item')} due this week, `
        + `${e.revisions_needed} being revised, and ${e.in_internal_review} with the account manager.`
    }
    if (data.scheduler) {
      const s = data.scheduler
      return `${plural(s.to_schedule, 'item')} ready to schedule, `
        + `${plural(s.upcoming_count ?? s.upcoming.length, 'post')} going out in the next 7 days, `
        + `and ${s.published_week} published this week.`
    }
    if (data.manager) {
      const m = data.manager
      const leads = m.latest_leads ? `, and ${plural(m.leads_week ?? 0, 'new lead')} came in this week` : ''
      return `${plural(m.awaiting_internal_review, 'item')} waiting on you, `
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
                    href={`/dashboard/production/${i.id}#comments`}
                    title={i.clients?.name ? `${i.clients.name} · ${i.title}` : i.title}
                    detail={statusLabel(i)} chip="Answer this" />
                ))}
                {data.waiting_on_you.shoots.map(s => (
                  <WorkRow key={s.id} tone="amber"
                    href={`/dashboard/production/shoots/${s.id}#comments`}
                    title={s.clients?.name ? `${s.clients.name} · ${s.title}` : s.title}
                    detail="Shoot" chip="Answer this" />
                ))}
              </div>
            </Section>
          )}

          {/* Seven identical grey ghost links and no cue which to press. The one
              thing a manager should do first now says so, and says how many. */}
          {!loading && role !== 'editor' && (data?.manager?.needs_review?.length ?? 0) > 0 && (
            <Button size="sm" className="min-h-11 w-fit" asChild>
              <Link href="/dashboard/editor">
                Review {data!.manager!.needs_review.length} item{data!.manager!.needs_review.length === 1 ? '' : 's'} waiting on you
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          )}

          {/* ---- the lists, per role ---- */}
          {!loading && role === 'editor' && data?.editor && (
            <>
              <Section title="Assigned to you" action={{ label: 'Open board', href: '/dashboard/editor' }}>
                <ItemRows items={data.editor.needs_action} todayKey={todayKey}
                  empty="Nothing waiting on you — all drafts are in review." />
              </Section>
              <Section title="Due soon" action={{ label: 'Open board', href: '/dashboard/editor' }}>
                <ItemRows items={data.editor.due_soon} todayKey={todayKey}
                  empty="Nothing due in the next 7 days." />
              </Section>
              {/* the open pool: work nobody holds, one click from being yours */}
              {data.editor.unassigned && (
                <Section title="Nobody has taken these yet" action={{ label: 'Open board', href: '/dashboard/editor' }}>
                  <ItemRows items={data.editor.unassigned} todayKey={todayKey}
                    empty="Nothing is going spare." />
                </Section>
              )}
            </>
          )}

          {role === 'scheduler' && data?.scheduler && (
            <>
              <Section title="Ready to schedule" action={{ label: 'Open queue', href: '/dashboard/scheduler' }}>
                <ItemRows items={data.scheduler.queue} todayKey={todayKey}
                  empty="Nothing waiting — approved items land here the moment they’re signed off." />
              </Section>
              <Section title="Going out next" action={{ label: 'Calendar', href: '/dashboard/scheduler/calendar' }}>
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
                          href={`/dashboard/production/${e.item_id}`}
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

          {data?.manager && (
            <>
              {(data.manager.my_tasks?.length ?? 0) > 0 && (
                <Section title="Assigned to you" action={{ label: 'Open board', href: '/dashboard/editor' }}>
                  <ItemRows items={data.manager.my_tasks} todayKey={todayKey} empty="" />
                </Section>
              )}
              {/* the three stages whose turn is a MANAGER's — the same
                  population the stat above it counts */}
              <Section title="Waiting on your sign-off" action={{ label: 'Open board', href: '/dashboard/editor' }}>
                <ItemRows items={data.manager.needs_review} todayKey={todayKey}
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
                {(formatInZone(now, zone, 'time') ?? '')} · {zoneLabel(zone)}
              </span>
            )}
          >
            <Timeline items={todayItems} empty="Nothing on today." />
          </Panel>
        </aside>
      </div>

      {/* ── the wide blocks, under both columns ── */}
      {!loading && (role === 'editor' || data?.manager) && <Pipeline pipeline={data?.pipeline} />}

      {data?.manager && (
        <>
          {/* the ledger first, then the alert it summarises */}
          <MonthAcrossClients />
          <AtRiskThisMonth />
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
