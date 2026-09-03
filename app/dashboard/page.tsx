'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  ArrowRight, Inbox, Users, TrendingUp, CalendarClock,
  ClipboardList, PencilLine, Send, CheckCircle2, Film, HandHelping,
  ChevronDown, ChevronLeft, ChevronRight, BarChart3,
} from 'lucide-react'
import Greeting from './Greeting'
import GettingStarted from './GettingStarted'
import { LoadFailed } from './NotSetUp'
import type { Role } from '../lib/identity-core'
import TeamLoadCard from './TeamLoadCard'
import { DEFAULT_TZ, formatInZone, viewerHint } from '../lib/timezone-core'
import { useTable } from '@/lib/db-client'
import type { Lead, ScheduleEntry, UserPageAccess } from '@/lib/db-types'
import { useRole } from './useRole'
import { useWorkRows } from './useLiveWork'
import { buildOverview, type OverviewItem } from '../lib/overview-core'
import { accessibleClientIdsOf } from '../lib/scope-client'
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

const STATUS_BADGE: Record<string, string> = {
  draft_uploaded: 'bg-zinc-50 text-zinc-600 border-zinc-200 dark:bg-zinc-900 dark:text-zinc-400 dark:border-zinc-800',
  internal_review: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-900',
  revision_required: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900',
  revision_complete: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900',
  client_review: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-400 dark:border-violet-900',
  client_changes_requested: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-400 dark:border-violet-900',
  approved_for_scheduling: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900',
  scheduled: 'bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-950/40 dark:text-cyan-400 dark:border-cyan-900',
  published: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900',
}

/** Plain words, and a shoot brief's own words when it is one. */
const statusLabel = (i: ItemLite) =>
  itemStatusLabel(i.work_kinds?.slug, i.status, STATUS_LABELS[i.status])

function Stat({ label, value, hint, loading, icon: Icon, href }: {
  label: string; value: string | number; hint?: string; loading: boolean
  icon: React.ComponentType<{ className?: string }>
  /** a number worth acting on links to the page you act on it from */
  href?: string
}) {
  const card = (
    <Card className={href ? 'transition-shadow hover:shadow-md' : undefined}>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">{label}</p>
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-50 dark:bg-blue-950/40">
            <Icon className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
          </div>
        </div>
        {loading
          ? <Skeleton className="mt-2 h-8 w-16" />
          : <p className="mt-1 font-mono text-3xl font-semibold tabular-nums tracking-tight">{value}</p>}
        {hint && <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>}
      </CardContent>
    </Card>
  )
  return href ? <Link href={href} className="block">{card}</Link> : card
}

function ItemList({ title, icon: Icon, items, empty, actionHref, actionLabel }: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  items: ItemLite[] | undefined
  empty: string
  actionHref: string
  actionLabel: string
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Icon className="h-4 w-4 text-zinc-400 dark:text-zinc-500" /> {title}
        </CardTitle>
        <Button variant="ghost" size="sm" className="ml-auto" asChild>
          <Link href={actionHref}>{actionLabel} <ArrowRight className="h-3.5 w-3.5" /></Link>
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 pt-0">
        {items === undefined && Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
        {items !== undefined && items.length === 0 && (
          <p className="py-6 text-center text-sm text-zinc-400 dark:text-zinc-500">{empty}</p>
        )}
        {(items ?? []).map(i => (
          <Link key={i.id} href={`/dashboard/production/${i.id}`}
            className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
            {/* the client name used to be `hidden sm:block`, so on a phone
                every row lost which client it belonged to. The title is what
                gives way now — the client is how you tell two reels apart. */}
            <span className="flex min-w-0 flex-col sm:flex-row sm:items-center sm:gap-3">
              <span className="min-w-0 truncate text-sm font-medium">{i.title}</span>
              {i.clients?.name && (
                <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">{i.clients.name}</span>
              )}
            </span>
            <Badge variant="outline" className={`ml-auto shrink-0 font-normal ${STATUS_BADGE[i.status] ?? ''}`}>
              {statusLabel(i)}
            </Badge>
          </Link>
        ))}
      </CardContent>
    </Card>
  )
}

type AtRiskLine = { type: string; label: string; quota: number; delivered: number; pace: string; in_production?: number; approved?: number; scheduled?: number; posted?: number }
type AtRiskClient = { id: string; name: string; has_agreement: boolean; worst: string; lines: AtRiskLine[] }

const PACE_DOT: Record<string, string> = {
  behind: 'bg-rose-500', tight: 'bg-amber-500', on_track: 'bg-emerald-500', met: 'bg-emerald-600',
}

const MONTH_CHIP: Record<MonthStatus, string> = {
  short: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-900',
  at_risk: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900',
  on_track: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-900',
  met: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900',
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
          className={`font-mono text-[11px] tabular-nums ${
            l.posted >= l.promised ? 'text-zinc-400 dark:text-zinc-500'
              : l.pace === 'behind' ? 'text-rose-600 dark:text-rose-400'
                : l.pace === 'tight' ? 'text-amber-600 dark:text-amber-400'
                  : 'text-zinc-500 dark:text-zinc-400'
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
    <Card>
      <CardHeader className="flex-row items-center gap-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <BarChart3 className="h-4 w-4 text-zinc-400 dark:text-zinc-500" /> This month across clients
        </CardTitle>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Previous month"
            onClick={() => setBack(b => Math.min(b + 1, 24))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[5.5rem] text-center font-mono text-[11px] uppercase tracking-wider text-zinc-400">
            {monthName}
          </span>
          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Next month"
            disabled={back === 0} onClick={() => setBack(b => Math.max(0, b - 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {failed
          ? <LoadFailed what="this month's numbers" detail={failed} onRetry={() => setAttempt(a => a + 1)} />
          : rows === null && <Skeleton className="h-40 w-full" />}
        {!failed && rows !== null && rows.length === 0 && (
          <p className="py-6 text-center text-sm text-zinc-400 dark:text-zinc-500">
            No active clients to report on.
          </p>
        )}

        {/* ---- 768px and up: the table ---- */}
        {rows !== null && rows.length > 0 && (
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
                  {['Client', 'Promised', 'Posted', 'Scheduled', 'In production', 'Status', 'Last post', 'Views'].map((h, i) => (
                    <th key={h} className={`py-2 font-mono text-[10px] uppercase tracking-[0.14em] font-normal text-zinc-400 dark:text-zinc-500 ${i > 0 ? 'px-3' : 'pr-3'}`}>
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
                className="w-full rounded-lg border border-zinc-200 p-3 text-left hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/60">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 truncate text-sm font-medium">{r.name}</span>
                  <Badge variant="outline" className={`ml-auto shrink-0 font-normal ${MONTH_CHIP[r.status]}`}>
                    {chipWords(r)}
                  </Badge>
                </div>
                <div className="mt-2 grid grid-cols-4 gap-2 font-mono text-xs tabular-nums">
                  {[
                    ['Promised', r.promised], ['Posted', r.posted],
                    ['Sched.', r.scheduled], ['In prod.', r.in_production],
                  ].map(([label, v]) => (
                    <div key={String(label)}>
                      <p className="text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500">{label}</p>
                      <p className="font-semibold">{v}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-2"><TypeChips row={r} /></div>
                <p className="mt-2 font-mono text-[11px] text-zinc-400 dark:text-zinc-500">
                  {r.last_post ? `Last post ${shortDate(r.last_post.at, r.tz)}` : 'No posts yet'}
                  {' · '}{r.views === null ? '—' : `${compactCount(r.views)} views`}
                </p>
              </button>
            ) : (
              <Link key={r.id} href={`/dashboard/clients/${r.id}/agreement`}
                className="flex items-center gap-2 rounded-lg border border-dashed border-zinc-200 p-3 text-sm text-zinc-400 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-500 dark:hover:bg-zinc-800/60">
                <span className="min-w-0 truncate font-medium">{r.name}</span>
                <span className="ml-auto shrink-0 text-xs">{NO_AGREEMENT_LINE} →</span>
              </Link>
            )))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function MonthTableRow({ row, expanded, onToggle, onOpen }: {
  row: MonthClientRow; expanded: boolean; onToggle: () => void; onOpen: () => void
}) {
  // no agreement on file: one muted row that is a to-do, not a measurement
  if (!row.has_agreement) {
    return (
      <tr className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
        <td className="py-2 pr-3 text-zinc-400 dark:text-zinc-500">{row.name}</td>
        <td colSpan={7} className="px-3 py-2">
          <Link href={`/dashboard/clients/${row.id}/agreement`}
            className="text-xs text-zinc-400 underline-offset-4 hover:underline dark:text-zinc-500">
            {NO_AGREEMENT_LINE} →
          </Link>
        </td>
      </tr>
    )
  }
  const num = 'px-3 py-2 font-mono tabular-nums'
  return (
    <>
      <tr onClick={onOpen}
        className="cursor-pointer border-b border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/60">
        <td className="py-2 pr-3">
          <span className="flex items-center gap-1.5">
            <button type="button" aria-label={expanded ? 'Hide types' : 'Show types'}
              aria-expanded={expanded}
              onClick={e => { e.stopPropagation(); onToggle() }}
              className="rounded p-0.5 text-zinc-300 hover:text-zinc-600 dark:text-zinc-600 dark:hover:text-zinc-300">
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? '' : '-rotate-90'}`} />
            </button>
            <span className="truncate font-medium">{row.name}</span>
          </span>
        </td>
        {/* the per-type breakdown is the chevron at the start of the row —
            one tap, on any device, not a hover */}
        <td className={`${num} font-semibold`}>{row.promised}</td>
        <td className={`${num} font-semibold`}>{row.posted}</td>
        <td className={`${num} text-zinc-500 dark:text-zinc-400`}>{row.scheduled}</td>
        <td className={`${num} text-zinc-500 dark:text-zinc-400`}>{row.in_production}</td>
        <td className="px-3 py-2">
          <Badge variant="outline" className={`shrink-0 font-normal ${MONTH_CHIP[row.status]}`}>
            {chipWords(row)}
          </Badge>
        </td>
        <td className="px-3 py-2 font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
          {row.last_post
            ? (row.last_post.item_id
                ? <Link href={`/dashboard/production/${row.last_post.item_id}`} onClick={e => e.stopPropagation()}
                    className="underline-offset-4 hover:underline">{shortDate(row.last_post.at, row.tz)}</Link>
                : shortDate(row.last_post.at, row.tz))
            : <span className="text-zinc-300 dark:text-zinc-600">—</span>}
        </td>
        <td className={`${num} text-zinc-500 dark:text-zinc-400`}>
          {row.views === null ? <span className="text-zinc-300 dark:text-zinc-600">—</span> : compactCount(row.views)}
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-zinc-100 bg-zinc-50/60 dark:border-zinc-800/60 dark:bg-zinc-900/40">
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
  if (rows === null) return <Skeleton className="h-24 w-full" />
  // every client still OWING something this month — not only the ones behind
  // pace. The dot carries urgency; the numbers carry what's left to deliver.
  const owing = rows.filter(c => c.has_agreement && c.lines.some(l => l.delivered < l.quota))
  return (
    <Card>
      <CardHeader className="flex-row items-center">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <TrendingUp className="h-4 w-4 text-zinc-400 dark:text-zinc-500" /> Agreement gaps this month
        </CardTitle>
        {/* the table above is the ledger — every client, met or not. This card
            is the alert: only what is still owed, and only where. Saying so
            stops the two reading as the same list twice. */}
        <span className="ml-auto text-[11px] text-zinc-400 dark:text-zinc-500">
          Only what’s still owed
        </span>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 pt-0">
        {owing.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-400 dark:text-zinc-500">
            Every agreement is fully delivered this month. Nice.
          </p>
        ) : owing.map(c => {
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
          <Link key={c.id} href={`/dashboard/clients/${c.id}/agreement`} className="flex flex-col gap-0.5 rounded-md px-2 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
            <span className="flex items-center gap-3">
              <span className={`h-2 w-2 shrink-0 rounded-full ${PACE_DOT[c.worst] ?? 'bg-zinc-400'}`} />
              <span className="min-w-0 truncate text-sm font-medium">{c.name}</span>
              <span className="ml-auto flex flex-wrap justify-end gap-1.5">
                {short.map(l => (
                  <span key={l.type}
                    className={`font-mono text-[11px] tabular-nums ${
                      l.pace === 'behind' ? 'text-red-500 dark:text-red-400'
                        : l.pace === 'tight' ? 'text-amber-600 dark:text-amber-400'
                        : 'text-zinc-500 dark:text-zinc-400'
                    }`}>
                    {l.label} {l.delivered}/{l.quota}
                  </span>
                ))}
              </span>
            </span>
            <span className="pl-5 text-[11px] text-zinc-400 dark:text-zinc-500">
              {movingWords ? `On the way: ${movingWords}` : 'Nothing in the pipeline yet for what is still owed'}
            </span>
          </Link>
          )
        })}
      </CardContent>
    </Card>
  )
}

/** The production funnel at a glance — draft → review → approval → published. */
function Pipeline({ pipeline }: { pipeline: Record<string, number> | undefined }) {
  const STAGES: { key: string; label: string; tint: string }[] = [
    // the same words the board uses — a stage is called one thing everywhere
    { key: 'draft_uploaded', label: STATUS_LABELS.draft_uploaded, tint: 'bg-zinc-400' },
    { key: 'internal_review', label: STATUS_LABELS.internal_review, tint: 'bg-blue-500' },
    { key: 'revision_required', label: STATUS_LABELS.revision_required, tint: 'bg-amber-500' },
    { key: 'client_review', label: STATUS_LABELS.client_review, tint: 'bg-violet-500' },
    { key: 'approved_for_scheduling', label: STATUS_LABELS.approved_for_scheduling, tint: 'bg-emerald-500' },
    { key: 'scheduled', label: STATUS_LABELS.scheduled, tint: 'bg-cyan-600' },
    { key: 'published', label: STATUS_LABELS.published, tint: 'bg-emerald-700' },
  ]
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 px-5 py-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-zinc-400">
          Where everything is right now
        </p>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {STAGES.map(s => (
          <div key={s.key} className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${s.tint}`} />
            <span className="text-xs text-zinc-500 dark:text-zinc-400">{s.label}</span>
            {pipeline === undefined
              ? <Skeleton className="h-4 w-5" />
              : <span className="font-mono text-sm font-semibold tabular-nums">{pipeline[s.key] ?? 0}</span>}
          </div>
        ))}
        </div>
      </CardContent>
    </Card>
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
  // resolved after mount: on the server there is no viewer to have a zone
  const [viewerTz, setViewerTz] = useState<string | null>(null)
  useEffect(() => { setViewerTz(browserZone()) }, [])

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
  const { rows: leadRows } = useTable<Lead>('leads', { orderBy: LEADS_NEWEST, enabled: mayLeads })
  const { rows: entryRows } = useTable<ScheduleEntry>(
    'schedule_entries', { enabled: enabled && viewer?.role === 'scheduler' })

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

  const loading = data === null
  const role = data?.role

  const subtitle =
    role === 'editor' ? 'Your production work, live.'
      : role === 'scheduler' ? 'What’s approved, scheduled, and going out — live.'
        : 'Where every client stands this month, live.'

  return (
    <div className="flex flex-col gap-4">
      <Greeting subtitle={subtitle} />

      {/* the only onboarding in the product — three steps for this role, each
          a real link, dismissed per person and per role */}
      {!loading && <GettingStarted role={(role ?? null) as Role | null} />}

      {/* somebody tagged you and it is not done — every role, whatever the
          client. The tag is the assignment; this is where it is answered. */}
      {!loading && data?.waiting_on_you
        && (data.waiting_on_you.items.length + data.waiting_on_you.shoots.length) > 0 && (
        <Card className="border-amber-200 dark:border-amber-900">
          <CardHeader className="flex-row items-center">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <ClipboardList className="h-4 w-4 text-amber-600 dark:text-amber-400" /> Waiting on you
            </CardTitle>
            <span className="ml-auto text-xs text-zinc-500 dark:text-zinc-400">
              Someone tagged you. Open it and mark the note done when you have answered.
            </span>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 pt-0">
            {data.waiting_on_you.items.map(i => (
              <Link key={i.id} href={`/dashboard/production/${i.id}#comments`}
                className="flex min-h-11 items-center gap-3 rounded-md px-2 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
                <span className="min-w-0 truncate text-sm font-medium">{i.title}</span>
                <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">{i.clients?.name ?? ''}</span>
                <ArrowRight className="ml-auto h-3.5 w-3.5 shrink-0 text-zinc-400" />
              </Link>
            ))}
            {data.waiting_on_you.shoots.map(s => (
              <Link key={s.id} href={`/dashboard/production/shoots/${s.id}#comments`}
                className="flex min-h-11 items-center gap-3 rounded-md px-2 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
                <span className="min-w-0 truncate text-sm font-medium">{s.title}</span>
                <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">{s.clients?.name ?? ''} · shoot</span>
                <ArrowRight className="ml-auto h-3.5 w-3.5 shrink-0 text-zinc-400" />
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Seven identical grey ghost links and no cue which to press. The one
          thing a manager should do first now says so, and says how many. */}
      {!loading && role !== 'editor' && (data?.manager?.needs_review?.length ?? 0) > 0 && (
        <Button size="sm" className="w-fit" asChild>
          <Link href="/dashboard/editor">
            Review {data!.manager!.needs_review.length} item{data!.manager!.needs_review.length === 1 ? '' : 's'} waiting on you
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      )}

      {/* one neutral skeleton until the role is known — branching while
          `loading` flashed the editor layout at every other role first */}
      {loading && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      )}

      {/* ---- editor ---- */}
      {!loading && role === 'editor' && data?.editor && (
        (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Stat label="My items" value={data!.editor!.my_items} loading={false} hint="Assigned to you" icon={Film} />
              <Stat label="Being revised" value={data!.editor!.revisions_needed} loading={false} hint="Revision required" icon={PencilLine} />
              <Stat label="Ready for review" value={data!.editor!.in_internal_review} loading={false} hint="With the account manager" icon={Send} />
              <Stat label="Due this week" value={data!.editor!.due_soon_count ?? data!.editor!.due_soon.length} loading={false} hint="Not yet scheduled" icon={CalendarClock} />
            </div>
            <Pipeline pipeline={data!.pipeline} />
            <div className="grid gap-4 lg:grid-cols-2">
              <ItemList title="Needs your action" icon={PencilLine} items={data!.editor!.needs_action}
                empty="Nothing waiting on you — all drafts are in review." actionHref="/dashboard/editor" actionLabel="Open board" />
              <ItemList title="Due soon" icon={CalendarClock} items={data!.editor!.due_soon}
                empty="Nothing due in the next 7 days." actionHref="/dashboard/editor" actionLabel="Open board" />
            </div>
            {/* the open pool: work nobody holds, one click from being yours */}
            {data!.editor!.unassigned && (
              <ItemList title="Nobody has taken these yet" icon={HandHelping} items={data!.editor!.unassigned}
                empty="Nothing is going spare." actionHref="/dashboard/editor" actionLabel="Open board" />
            )}
          </>
        )
      )}

      {/* ---- scheduler ---- */}
      {role === 'scheduler' && data?.scheduler && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label={STATUS_LABELS.approved_for_scheduling} value={data.scheduler.to_schedule} loading={false} hint="Signed off, waiting on you" icon={ClipboardList} />
            <Stat label="Going out · 7 days" value={data.scheduler.upcoming_count ?? data.scheduler.upcoming.length} loading={false} hint="Scheduled posts" icon={CalendarClock} />
            <Stat label="Published · 7 days" value={data.scheduler.published_week} loading={false} hint="Live this week" icon={CheckCircle2} />
            <Stat label="Scheduled total" value={data.pipeline.scheduled ?? 0} loading={false} hint="In the calendar" icon={Send} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <ItemList title="Ready to schedule" icon={ClipboardList} items={data.scheduler.queue}
              empty="Nothing waiting — approved items land here the moment they’re signed off." actionHref="/dashboard/scheduler" actionLabel="Open queue" />
            <Card>
              <CardHeader className="flex-row items-center">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                  <CalendarClock className="h-4 w-4 text-zinc-400 dark:text-zinc-500" /> Going out next
                </CardTitle>
                <Button variant="ghost" size="sm" className="ml-auto" asChild>
                  <Link href="/dashboard/scheduler/calendar">Calendar <ArrowRight className="h-3.5 w-3.5" /></Link>
                </Button>
              </CardHeader>
              <CardContent className="flex flex-col gap-1 pt-0">
                {data.scheduler.upcoming.length === 0 && (
                  <p className="py-6 text-center text-sm text-zinc-400 dark:text-zinc-500">Nothing scheduled for the next 7 days.</p>
                )}
                {data.scheduler.upcoming.map(e => {
                  // when it reaches the AUDIENCE — this strip mixes clients,
                  // so the zone comes from the row, not the page
                  const tz = e.content_items?.clients?.timezone || DEFAULT_TZ
                  // "= 1:00 pm your time" for a scheduler in Manila. This was a
                  // hover-only title= — the one fact a phone user most needs.
                  const mine = viewerHint(e.scheduled_at, tz, viewerTz)
                  return (
                  <Link key={e.id} href={`/dashboard/production/${e.item_id}`}
                    className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
                    <span className="flex min-w-0 flex-col sm:flex-row sm:items-center sm:gap-3">
                      <span className="min-w-0 truncate text-sm font-medium">{e.content_items?.title ?? '—'}</span>
                      {e.content_items?.clients?.name && (
                        <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">{e.content_items.clients.name}</span>
                      )}
                    </span>
                    <span className="ml-auto flex shrink-0 flex-col items-end gap-0.5 sm:flex-row sm:items-center sm:gap-2">
                      <Badge variant="outline" className="font-normal capitalize text-zinc-600 dark:text-zinc-400">{e.platform}</Badge>
                      {e.scheduled_at && (
                        <span className="text-right font-mono text-[11px] text-zinc-400 dark:text-zinc-500">
                          {formatInZone(e.scheduled_at, tz, 'short')}
                          {mine && <span className="block text-[10px] text-zinc-400 dark:text-zinc-500 sm:inline sm:before:content-['_·_']">{mine}</span>}
                        </span>
                      )}
                    </span>
                  </Link>
                  )
                })}
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {/* ---- account manager / super admin ---- */}
      {data?.manager && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Clients" value={data.manager.clients} loading={false} hint="You look after" icon={Users} />
            <Stat label="Ready for review" value={data.manager.awaiting_internal_review} loading={false} hint="Waiting on your sign-off" icon={ClipboardList} />
            <Stat label="With client" value={data.manager.awaiting_client} loading={false} hint="In client review" icon={Send} />
            {data.manager.latest_leads
              ? <Stat label="Leads · 7 days" value={data.manager.leads_week ?? 0} loading={false} hint={`${data.manager.leads_total ?? 0}+ total`} icon={TrendingUp} />
              : <Stat label="Being revised" value={data.manager.revisions_open} loading={false} hint="In the edit loop" icon={TrendingUp} />}
            {data.manager.unassigned_count !== undefined && (
              <Stat label="Unassigned" value={data.manager.unassigned_count} loading={false}
                hint="Nobody has picked these up" icon={HandHelping} href="/dashboard/editor" />
            )}
          </div>
          <Pipeline pipeline={data.pipeline} />
          {/* the ledger first, then the alert it summarises */}
          <MonthAcrossClients />
          <AtRiskThisMonth />
          {(data.manager.my_tasks?.length ?? 0) > 0 && (
            <ItemList title="Assigned to you" icon={ClipboardList} items={data.manager.my_tasks}
              empty="" actionHref="/dashboard/editor" actionLabel="Open board" />
          )}
          <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
            {/* the three stages whose turn is a MANAGER's — the same
                population the stat above it counts */}
            <ItemList title="Waiting on you" icon={ClipboardList} items={data.manager.needs_review}
              empty="Nothing is waiting on you right now." actionHref="/dashboard/editor" actionLabel="Open board" />
            <div className="flex flex-col gap-4">
              {/* what is waiting on YOU, beside who else is behind */}
              <TeamLoadCard />
            {data.manager.latest_leads && <>
              <Card>
                <CardHeader className="flex-row items-center">
                  <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                    <Inbox className="h-4 w-4 text-zinc-400 dark:text-zinc-500" /> Latest leads
                  </CardTitle>
                  <Button variant="ghost" size="sm" className="ml-auto" asChild>
                    <Link href="/dashboard/leads">View all <ArrowRight className="h-3.5 w-3.5" /></Link>
                  </Button>
                </CardHeader>
                <CardContent className="flex flex-col gap-1 pt-0">
                  {data.manager.latest_leads.length === 0 && (
                    <p className="py-6 text-center text-sm text-zinc-400 dark:text-zinc-500">No leads yet.</p>
                  )}
                  {data.manager.latest_leads.map(l => (
                    <div key={l.id} className="flex items-baseline gap-3 rounded-md px-2 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
                      <span className="text-sm font-medium">{l.fname} {l.lname}</span>
                      <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">{l.biz}</span>
                      <span className="ml-auto shrink-0 font-mono text-[11px] uppercase text-zinc-400 dark:text-zinc-500">
                        {new Date(l.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                      </span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </>}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
