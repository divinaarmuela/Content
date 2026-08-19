'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  ArrowRight, Inbox, Users, ExternalLink, TrendingUp, CalendarClock,
  ClipboardList, PencilLine, Send, CheckCircle2, Film,
} from 'lucide-react'
import Greeting from './Greeting'
import { useProductionLive } from './production/useProductionLive'

type ItemLite = {
  id: string; title: string; status: string; content_type: string
  priority: string; due_date: string | null
  clients: { name: string } | null
}
type LeadLite = { id: string; created_at: string; fname: string; lname: string; biz: string }
type UpcomingEntry = {
  id: string; platform: string; scheduled_at: string | null; item_id: string
  content_items: { id: string; title: string; clients: { name: string } | null } | null
}

type Overview = {
  role: string
  name: string
  pipeline: Record<string, number>
  editor?: {
    my_items: number
    in_internal_review: number
    revisions_needed: number
    needs_action: ItemLite[]
    due_soon: ItemLite[]
  }
  scheduler?: {
    to_schedule: number
    queue: ItemLite[]
    upcoming: UpcomingEntry[]
    published_week: number
  }
  manager?: {
    clients: number
    awaiting_internal_review: number
    awaiting_client: number
    revisions_open: number
    needs_review: ItemLite[]
    leads_total: number
    leads_week: number
    latest_leads: LeadLite[]
  }
}

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

const statusLabel = (s: string) => s.replace(/_/g, ' ')

function Stat({ label, value, hint, loading, icon: Icon }: {
  label: string; value: string | number; hint?: string; loading: boolean
  icon: React.ComponentType<{ className?: string }>
}) {
  return (
    <Card>
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
            <span className="min-w-0 truncate text-sm font-medium">{i.title}</span>
            <span className="hidden truncate text-xs text-zinc-500 dark:text-zinc-400 sm:block">{i.clients?.name ?? ''}</span>
            <Badge variant="outline" className={`ml-auto shrink-0 font-normal capitalize ${STATUS_BADGE[i.status] ?? ''}`}>
              {statusLabel(i.status)}
            </Badge>
          </Link>
        ))}
      </CardContent>
    </Card>
  )
}

/** The production funnel at a glance — draft → review → approval → published. */
function Pipeline({ pipeline }: { pipeline: Record<string, number> | undefined }) {
  const STAGES: { key: string; label: string; tint: string }[] = [
    { key: 'draft_uploaded', label: 'Draft', tint: 'bg-zinc-400' },
    { key: 'internal_review', label: 'Internal review', tint: 'bg-blue-500' },
    { key: 'revision_required', label: 'Revisions', tint: 'bg-amber-500' },
    { key: 'client_review', label: 'Client review', tint: 'bg-violet-500' },
    { key: 'approved_for_scheduling', label: 'Approved', tint: 'bg-emerald-500' },
    { key: 'scheduled', label: 'Scheduled', tint: 'bg-cyan-600' },
    { key: 'published', label: 'Published', tint: 'bg-emerald-700' },
  ]
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-4">
        {STAGES.map(s => (
          <div key={s.key} className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${s.tint}`} />
            <span className="text-xs text-zinc-500 dark:text-zinc-400">{s.label}</span>
            {pipeline === undefined
              ? <Skeleton className="h-4 w-5" />
              : <span className="font-mono text-sm font-semibold tabular-nums">{pipeline[s.key] ?? 0}</span>}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

export default function OverviewPage() {
  const [data, setData] = useState<Overview | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/overview')
      if (!res.ok) return
      setData(await res.json())
    } catch { /* transient — the poll retries */ }
  }, [])

  useEffect(() => { load() }, [load])
  // snapshot feel: any production change anywhere repaints the overview
  useProductionLive(load)

  const loading = data === null
  const role = data?.role

  const subtitle =
    role === 'editor' ? 'Your production work, live.'
      : role === 'scheduler' ? 'What’s approved, scheduled, and going out — live.'
        : 'Live numbers from the master database.'

  return (
    <div className="flex flex-col gap-4">
      <Greeting subtitle={subtitle} />

      {/* ---- editor ---- */}
      {(loading || role === 'editor') && role !== 'scheduler' && !data?.manager && (
        loading ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Stat label="My items" value={data!.editor!.my_items} loading={false} hint="Assigned to you" icon={Film} />
              <Stat label="Needs re-edit" value={data!.editor!.revisions_needed} loading={false} hint="Revision required" icon={PencilLine} />
              <Stat label="In internal review" value={data!.editor!.in_internal_review} loading={false} hint="With the account manager" icon={Send} />
              <Stat label="Due this week" value={data!.editor!.due_soon.length} loading={false} hint="Not yet scheduled" icon={CalendarClock} />
            </div>
            <Pipeline pipeline={data!.pipeline} />
            <div className="grid gap-4 lg:grid-cols-2">
              <ItemList title="Needs your action" icon={PencilLine} items={data!.editor!.needs_action}
                empty="Nothing waiting on you — all drafts are in review." actionHref="/dashboard/production" actionLabel="Open board" />
              <ItemList title="Due soon" icon={CalendarClock} items={data!.editor!.due_soon}
                empty="Nothing due in the next 7 days." actionHref="/dashboard/production" actionLabel="Open board" />
            </div>
          </>
        )
      )}

      {/* ---- scheduler ---- */}
      {role === 'scheduler' && data?.scheduler && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="To schedule" value={data.scheduler.to_schedule} loading={false} hint="Approved, waiting on you" icon={ClipboardList} />
            <Stat label="Going out · 7 days" value={data.scheduler.upcoming.length} loading={false} hint="Scheduled posts" icon={CalendarClock} />
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
                {data.scheduler.upcoming.map(e => (
                  <Link key={e.id} href={`/dashboard/production/${e.item_id}`}
                    className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
                    <span className="min-w-0 truncate text-sm font-medium">{e.content_items?.title ?? '—'}</span>
                    <span className="hidden truncate text-xs text-zinc-500 dark:text-zinc-400 sm:block">{e.content_items?.clients?.name ?? ''}</span>
                    <span className="ml-auto flex shrink-0 items-center gap-2">
                      <Badge variant="outline" className="font-normal capitalize text-zinc-600 dark:text-zinc-400">{e.platform}</Badge>
                      {e.scheduled_at && (
                        <span className="font-mono text-[11px] text-zinc-400 dark:text-zinc-500">
                          {new Date(e.scheduled_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                        </span>
                      )}
                    </span>
                  </Link>
                ))}
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
            <Stat label="Internal review" value={data.manager.awaiting_internal_review} loading={false} hint="Waiting on your sign-off" icon={ClipboardList} />
            <Stat label="With client" value={data.manager.awaiting_client} loading={false} hint="In client review" icon={Send} />
            <Stat label="Leads · 7 days" value={data.manager.leads_week} loading={false} hint={`${data.manager.leads_total}+ total`} icon={TrendingUp} />
          </div>
          <Pipeline pipeline={data.pipeline} />
          <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
            <ItemList title="Waiting on review" icon={ClipboardList} items={data.manager.needs_review}
              empty="Nothing in review — the funnel is clear." actionHref="/dashboard/production" actionLabel="Open board" />
            <div className="flex flex-col gap-4">
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
              <Card>
                <CardHeader className="flex-row items-center">
                  <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                    <ExternalLink className="h-4 w-4 text-zinc-400 dark:text-zinc-500" /> Quick links
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-1 pt-0 text-sm">
                  <a href="https://www.mdmmarketing.com.au" target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100">
                    Live site <ExternalLink className="h-3 w-3" />
                  </a>
                  <a href="https://calendly.com/mdmmarketing-info" target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100">
                    Calendly <ExternalLink className="h-3 w-3" />
                  </a>
                  <a href="https://scorecard.mdmmarketing.com.au" target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100">
                    Diagnostic scorecard <ExternalLink className="h-3 w-3" />
                  </a>
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
