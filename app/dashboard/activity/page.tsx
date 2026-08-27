'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ChevronRight, ChevronLeft, ExternalLink, Inbox, Settings2, CircleAlert, CheckCircle2, Users, CalendarDays } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import AsanaSetup from './AsanaSetup'

type Task = {
  gid: string
  name: string
  due_on: string | null
  url: string | null
  project: string | null
  overdue: boolean
}

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
  tasks: { open: Task[]; done: Task[] }
}

type Payload = {
  rows: Row[]
  range: { from: string; to: string; days: number }
  viewer: { id: string; isAdmin: boolean; timezone: string }
  clients: { id: string; name: string }[]
  connection: { configured: boolean; trackedProjects: number; liveWebhooks: number; lastEventAt: string | null } | null
}

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

function dueLabel(due: string | null): string {
  if (!due) return 'no date'
  return new Date(due + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}

function initials(name: string, email: string): string {
  return (name.trim() || email).split(/[\s@.]+/).filter(Boolean).slice(0, 2)
    .map(p => p[0]?.toUpperCase()).join('')
}

export default function ActivityPage() {
  const [data, setData] = useState<Payload | null>(null)
  const [type, setType] = useState<'all' | 'employee' | 'contractor'>('all')
  const [client, setClient] = useState<string>('all')
  const [view, setView] = useState<'people' | 'calendar'>('people')
  const [showSetup, setShowSetup] = useState(false)
  const [open, setOpen] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams()
      if (type !== 'all') qs.set('type', type)
      if (client !== 'all') qs.set('client', client)
      const res = await fetch(`/api/team/activity?${qs}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load activity')
      setData(json)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load activity')
      setData(null)
    }
  }, [type, client])

  useEffect(() => { load() }, [load])

  const isAdmin = data?.viewer.isAdmin ?? false
  const rows = data?.rows ?? []
  // Someone with no Asana link and no work is noise in a team view; keep them
  // only when nobody has anything, so the empty state can explain itself.
  const withWork = rows.filter(r => r.open > 0 || r.completed > 0 || r.eventCount > 0)
  const visible = withWork.length > 0 ? withWork : rows

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Asana activity</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {isAdmin ? 'Who is working on what, from Asana. Production work lives on the item’s own History card.' : 'Your work, from Asana. Production work lives on the item’s own History card.'}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Tabs value={view} onValueChange={v => v && setView(v as 'people' | 'calendar')}>
            <TabsList>
              <TabsTrigger value="people" className="gap-1.5"><Users className="h-3.5 w-3.5" /> People</TabsTrigger>
              <TabsTrigger value="calendar" className="gap-1.5"><CalendarDays className="h-3.5 w-3.5" /> Calendar</TabsTrigger>
            </TabsList>
          </Tabs>
          {isAdmin && (
            <Button variant={showSetup ? 'secondary' : 'outline'} size="sm" onClick={() => setShowSetup(s => !s)}>
              <Settings2 className="h-3.5 w-3.5" /> Connection
            </Button>
          )}
        </div>
      </div>

      {/* Filters sit in one row above the content, and only appear when there
          is something to filter by. */}
      {isAdmin && (
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={type} onValueChange={v => v && setType(v as typeof type)}>
            <TabsList>
              <TabsTrigger value="all">Everyone</TabsTrigger>
              <TabsTrigger value="employee">Employees</TabsTrigger>
              <TabsTrigger value="contractor">Contractors</TabsTrigger>
            </TabsList>
          </Tabs>

          {(data?.clients.length ?? 0) > 0 && (
            <Select value={client} onValueChange={setClient}>
              <SelectTrigger className="h-9 w-56 bg-white dark:bg-zinc-900">
                <SelectValue placeholder="All clients" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All clients</SelectItem>
                {data?.clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}

          {(type !== 'all' || client !== 'all') && (
            <Button variant="ghost" size="sm" onClick={() => { setType('all'); setClient('all') }}>
              Clear
            </Button>
          )}
        </div>
      )}


      {isAdmin && showSetup && <AsanaSetup onChanged={() => load()} />}

      {data === null ? (
        <Card><CardContent className="flex flex-col gap-3 p-6">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
        </CardContent></Card>
      ) : withWork.length === 0 ? (
        <Card className="border-dashed shadow-none">
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
            <Inbox className="h-6 w-6 text-zinc-300 dark:text-zinc-600" />
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {data.connection && !data.connection.configured
                ? 'Asana isn’t connected yet.'
                : data.connection && data.connection.trackedProjects === 0
                  ? 'Not connected to Asana yet.'
                  : rows.every(r => !r.linked)
                    ? 'No Asana account is matched to you yet.'
                    : 'No open or completed work in this period.'}
            </p>
            {isAdmin && !showSetup && (
              <Button variant="outline" size="sm" onClick={() => setShowSetup(true)}>Open connection settings</Button>
            )}
          </CardContent>
        </Card>
      ) : view === 'calendar' ? (
        <TaskCalendar rows={visible} />
      ) : (
        <div className="flex flex-col gap-2">
          {visible
            .sort((a, b) => b.overdue - a.overdue || b.open - a.open)
            .map(person => (
              <PersonCard
                key={person.id}
                person={person}
                expanded={open === person.id || visible.length === 1}
                onToggle={() => setOpen(o => (o === person.id ? null : person.id))}
                days={data?.range.days ?? 30}
              />
            ))}
        </div>
      )}

      {isAdmin && data?.connection?.configured && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {data.connection.trackedProjects} projects tracked · {data.connection.liveWebhooks} live ·
          {' '}last change {sinceLabel(data.connection.lastEventAt)}
        </p>
      )}
    </div>
  )
}

/**
 * One person: the counts to scan, the tasks to act on.
 *
 * The counts alone answered "how much" and left "what" in Asana, which meant
 * the page could not replace opening Asana — the whole point of it.
 */
function PersonCard({ person, expanded, onToggle, days }: {
  person: Row; expanded: boolean; onToggle: () => void; days: number
}) {
  const stat = (label: string, value: number, alert = false) => (
    <div className="text-right">
      <p className={`font-mono text-lg tabular-nums ${alert && value > 0 ? 'text-red-600 dark:text-red-400' : 'text-zinc-900 dark:text-zinc-100'}`}>
        {value}
      </p>
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-zinc-400">{label}</p>
    </div>
  )

  return (
    <Card className={person.overdue > 0 ? 'border-red-200 dark:border-red-900/60' : undefined}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
      >
        <ChevronRight className={`h-4 w-4 shrink-0 text-zinc-400 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-zinc-100 font-mono text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          {initials(person.name, person.email)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{person.name || person.email}</span>
          <span className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-zinc-400">
            {person.employment_type}
            {!person.linked && (
              <span className="inline-flex items-center gap-1 normal-case tracking-normal text-amber-600 dark:text-amber-500">
                <CircleAlert className="h-3 w-3" /> not matched
              </span>
            )}
            {person.lastActivityAt && (
              <span className="normal-case tracking-normal text-zinc-400">· {sinceLabel(person.lastActivityAt)}</span>
            )}
          </span>
        </span>
        <span className="flex items-center gap-5 pr-1">
          {stat('open', person.open)}
          {stat('overdue', person.overdue, true)}
          {stat('done', person.completed)}
        </span>
      </button>

      {expanded && (
        <CardContent className="border-t border-zinc-100 pt-3 dark:border-zinc-800">
          {person.tasks.open.length === 0 && person.tasks.done.length === 0 ? (
            <p className="py-2 text-sm text-zinc-500 dark:text-zinc-400">
              {person.linked ? 'No tasks in this period.' : 'No Asana account matched to this person yet.'}
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {person.tasks.open.length > 0 && (
                <TaskList title="Open" tasks={person.tasks.open} />
              )}
              {person.tasks.done.length > 0 && (
                <TaskList title={`Completed · last ${days} days`} tasks={person.tasks.done} done />
              )}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  )
}

/**
 * The same tasks, arranged by when they are due rather than by who owns them.
 *
 * Deadlines are the thing a week is actually shaped by, and a per-person list
 * hides them — three people each with one task on Friday reads as nothing
 * until you see them stacked on the same day.
 */
function TaskCalendar({ rows }: { rows: Row[] }) {
  const [anchor, setAnchor] = useState(() => new Date())
  /** days whose "+N more" has been tapped open — those tasks were
   *  otherwise unreachable from this view */
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())

  const byDay = new Map<string, { task: Task; who: string }[]>()
  for (const person of rows) {
    for (const task of person.tasks.open) {
      if (!task.due_on) continue
      const list = byDay.get(task.due_on) ?? []
      list.push({ task, who: person.name || person.email })
      byDay.set(task.due_on, list)
    }
  }

  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const start = new Date(first)
  start.setDate(first.getDate() - ((first.getDay() + 6) % 7))   // Monday-first
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return d
  })
  const trimmed = cells.slice(35).every(d => d.getMonth() !== anchor.getMonth()) ? cells.slice(0, 35) : cells

  const key = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const todayKey = key(new Date())
  const undated = rows.flatMap(p => p.tasks.open.filter(t => !t.due_on)).length

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm"
          onClick={() => setAnchor(a => new Date(a.getFullYear(), a.getMonth() - 1, 1))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-40 text-sm font-medium">
          {anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </span>
        <Button variant="outline" size="sm"
          onClick={() => setAnchor(a => new Date(a.getFullYear(), a.getMonth() + 1, 1))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setAnchor(new Date())}>Today</Button>
        {undated > 0 && (
          <span className="ml-auto text-xs text-zinc-500 dark:text-zinc-400">
            {undated} open task{undated === 1 ? '' : 's'} with no due date
          </span>
        )}
      </div>

      {/* the legend goes BEFORE the thing it explains — it used to sit under
          ~500px of calendar, where a phone reads it last or never */}
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Open tasks by due date. Red is past due. Completed work isn’t shown here — use the People view for that.
      </p>

      <div className="overflow-x-auto">
        <div className="min-w-[720px]">
          <div className="grid grid-cols-7 gap-px rounded-t-lg bg-zinc-200 dark:bg-zinc-800">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
              <div key={d} className="bg-white px-2 py-1.5 text-xs font-medium text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-px rounded-b-lg bg-zinc-200 dark:bg-zinc-800">
            {trimmed.map(d => {
              const k = key(d)
              const items = byDay.get(k) ?? []
              const otherMonth = d.getMonth() !== anchor.getMonth()
              const past = k < todayKey
              return (
                <div key={k} className={`min-h-[104px] bg-white p-1.5 dark:bg-zinc-900 ${otherMonth ? 'opacity-40' : ''}`}>
                  <span className={`text-xs tabular-nums ${
                    k === todayKey
                      ? 'flex h-5 w-5 items-center justify-center rounded-full bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                      : 'text-zinc-400 dark:text-zinc-500'
                  }`}>
                    {d.getDate()}
                  </span>
                  <ul className="mt-1 flex flex-col gap-1">
                    {(expanded.has(k) ? items : items.slice(0, 3)).map(({ task, who }) => (
                      <li key={task.gid}>
                        {/* no title= — the whole name wraps, and the project
                            is on its own line, so nothing needs a hover */}
                        <a
                          href={task.url ?? undefined}
                          target="_blank" rel="noreferrer noopener"
                          className={`block rounded px-1 py-0.5 text-[11px] transition-colors ${
                            past
                              ? 'bg-red-50 text-red-800 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-300'
                              : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300'
                          }`}
                        >
                          <span className="line-clamp-2">{task.name}</span>
                          <span className="block truncate text-zinc-400">
                            {who.split(' ')[0]}{task.project ? ` · ${task.project}` : ''}
                          </span>
                        </a>
                      </li>
                    ))}
                    {items.length > 3 && (
                      <li>
                        <button type="button"
                          onClick={() => setExpanded(s => {
                            const next = new Set(s)
                            if (next.has(k)) next.delete(k); else next.add(k)
                            return next
                          })}
                          className="w-full rounded px-1 py-0.5 text-left text-[11px] text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400">
                          {expanded.has(k) ? 'Show fewer' : `+${items.length - 3} more`}
                        </button>
                      </li>
                    )}
                  </ul>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

function TaskList({ title, tasks, done = false }: { title: string; tasks: Task[]; done?: boolean }) {
  return (
    <div>
      <p className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-zinc-400">{title}</p>
      <ul className="flex flex-col">
        {tasks.map(t => (
          <li key={t.gid}
            className="flex items-center gap-2.5 border-b border-zinc-100 py-1.5 last:border-b-0 dark:border-zinc-800/60">
            {done
              ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              : <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${t.overdue ? 'bg-red-500' : 'bg-zinc-300 dark:bg-zinc-600'}`} />}

            <span className={`min-w-0 flex-1 truncate text-sm ${done ? 'text-zinc-500 line-through dark:text-zinc-500' : ''}`}>
              {t.name}
            </span>

            {t.project && (
              <Badge variant="outline" className="hidden shrink-0 font-normal text-zinc-500 sm:inline-flex dark:text-zinc-400">
                {t.project}
              </Badge>
            )}

            {!done && (
              <span className={`shrink-0 font-mono text-xs tabular-nums ${
                t.overdue ? 'text-red-600 dark:text-red-400' : 'text-zinc-400'
              }`}>
                {dueLabel(t.due_on)}
              </span>
            )}

            {t.url && (
              <a href={t.url} target="_blank" rel="noreferrer noopener"
                className="shrink-0 text-zinc-400 transition-colors hover:text-zinc-700 dark:hover:text-zinc-200"
                aria-label={`Open "${t.name}" in Asana`}>
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
