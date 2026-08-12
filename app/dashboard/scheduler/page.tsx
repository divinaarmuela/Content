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
import type { ItemStatus } from '../../lib/workflow-core'

type ScheduleEntry = { platform: string; scheduled_at: string | null; live_url: string | null }
type Item = {
  id: string
  title: string
  content_type: string
  status: ItemStatus
  caption: string | null
  current_version_number: number
  clients: { name: string } | null
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

/** The QUEUE view. Calendar and Availability are sibling routes; the shared
 *  header and view switcher live in layout.tsx. */
export default function SchedulerPage() {
  const [items, setItems] = useState<Item[] | null>(null)
  const [schedules, setSchedules] = useState<Record<string, ScheduleEntry[]>>({})
  const [lane, setLane] = useState<string>('approved_for_scheduling')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/production/items')
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to load queue')
      const all: Item[] = await res.json()
      const queue = all.filter(i => LANES.some(l => l.key === i.status))
      setItems(queue)
      // fetch schedule entries for scheduled/published rows (small N, parallel)
      const withSchedule = queue.filter(i => i.status !== 'approved_for_scheduling').slice(0, 40)
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

  const visible = (items ?? []).filter(i => i.status === lane)
  const counts = Object.fromEntries(LANES.map(l => [l.key, (items ?? []).filter(i => i.status === l.key).length]))

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
      </div>

      {items === null ? (
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
              {lane === 'approved_for_scheduling'
                ? 'Nothing waiting — items appear here the moment they’re approved for scheduling.'
                : 'Nothing here yet.'}
            </p>
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
                return (
                  <TableRow key={item.id}>
                    <TableCell>
                      <div className="text-sm font-medium">{item.title}</div>
                      <div className="font-mono text-xs text-zinc-400 dark:text-zinc-500">
                        {item.content_type} · v{item.current_version_number}
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
                        <Badge variant="outline" className={STATUS_BADGE[item.status]}>ready</Badge>
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
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/dashboard/production/${item.id}`}>
                          {lane === 'approved_for_scheduling' ? 'Schedule' : 'Open'} <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                      </Button>
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
