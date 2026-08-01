'use client'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  Globe,
  RotateCcw,
  Send,
  Upload,
  UserPlus,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

type EventType =
  | 'submit'
  | 'client'
  | 'approve'
  | 'schedule'
  | 'publish'
  | 'upload'
  | 'revision'
  | 'assign'

type ActivityEvent = {
  user: string
  name: string
  action: string
  entity: string
  client: string
  time: string
  type: EventType
}

const EVENTS: ActivityEvent[] = [
  { user: 'AK', name: 'Akmal K.',  action: 'submitted for internal review',      entity: 'BTS gym session — 60s cut',       client: 'Apex Fitness',   time: '2 min ago',  type: 'submit'   },
  { user: 'DV', name: 'Divina A.', action: 'sent to client for review',          entity: 'May results carousel',            client: 'Align Wellness', time: '14 min ago', type: 'client'   },
  { user: 'CL', name: 'Client',    action: 'approved',                           entity: 'Skincare routine — 30s reel',     client: 'Bloom Skincare', time: '32 min ago', type: 'approve'  },
  { user: 'DV', name: 'Divina A.', action: 'approved for scheduling',            entity: 'Skincare routine — 30s reel',     client: 'Bloom Skincare', time: '35 min ago', type: 'schedule' },
  { user: 'MW', name: 'Marcus W.', action: 'marked published · added live URL',  entity: 'Cold brew launch campaign',       client: 'Surge Coffee',   time: '1 hr ago',   type: 'publish'  },
  { user: 'JR', name: 'Jake R.',   action: 'uploaded v2 after revision',         entity: 'Barista morning routine',         client: 'Surge Coffee',   time: '2 hr ago',   type: 'upload'   },
  { user: 'DV', name: 'Divina A.', action: 'requested revision',                 entity: 'Barista morning routine',         client: 'Surge Coffee',   time: '3 hr ago',   type: 'revision' },
  { user: 'SL', name: 'Sarah L.',  action: 'submitted for internal review',      entity: 'Brand story carousel — 5 slides', client: 'NovaBuild Co.',  time: '4 hr ago',   type: 'submit'   },
  { user: 'CL', name: 'Client',    action: 'requested changes',                  entity: 'PT promo — 3 variant reels',      client: 'Apex Fitness',   time: '5 hr ago',   type: 'revision' },
  { user: 'DV', name: 'Divina A.', action: 'assigned client change to editor',   entity: 'PT promo — 3 variant reels',      client: 'Apex Fitness',   time: '5 hr ago',   type: 'assign'   },
  { user: 'AK', name: 'Akmal K.',  action: 'scheduled · Jun 22 9:00 AM',         entity: 'Cold brew launch campaign',       client: 'Surge Coffee',   time: 'Yesterday',  type: 'schedule' },
  { user: 'MW', name: 'Marcus W.', action: 'uploaded v1 draft',                  entity: 'Mindfulness ep. 3',               client: 'Align Wellness', time: 'Yesterday',  type: 'upload'   },
  { user: 'JR', name: 'Jake R.',   action: 'submitted for internal review',      entity: 'Thought leadership talking head', client: 'Vertex Legal',   time: 'Jun 15',     type: 'submit'   },
  { user: 'CL', name: 'Client',    action: 'approved',                           entity: 'Case study — TechCorp',           client: 'Vertex Legal',   time: 'Jun 14',     type: 'approve'  },
]

const TYPE_META: Record<EventType, { icon: LucideIcon; className: string }> = {
  submit:   { icon: ArrowUpRight,  className: 'bg-zinc-50 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200' },
  client:   { icon: Send,          className: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400' },
  approve:  { icon: CheckCircle2,  className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400' },
  schedule: { icon: CalendarClock, className: 'bg-zinc-50 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200' },
  publish:  { icon: Globe,         className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400' },
  upload:   { icon: Upload,        className: 'bg-zinc-50 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200' },
  revision: { icon: RotateCcw,     className: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400' },
  assign:   { icon: UserPlus,      className: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400' },
}

const DAY_GROUPS: { label: string; events: ActivityEvent[] }[] = [
  { label: 'Today',     events: EVENTS.slice(0, 10) },
  { label: 'Yesterday', events: EVENTS.slice(10, 12) },
  { label: 'Jun 15',    events: EVENTS.slice(12, 13) },
  { label: 'Jun 14',    events: EVENTS.slice(13, 14) },
]

export default function ActivityPage() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Activity Log</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Every status change, upload, comment and approval — timestamped.
          </p>
        </div>
        <Badge
          variant="outline"
          className="ml-auto font-mono text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500"
        >
          Demo data
        </Badge>
      </div>

      <Card className="border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Recent activity
          </CardTitle>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500 tabular-nums">
            {EVENTS.length} events
          </span>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {DAY_GROUPS.map(group => (
            <div key={group.label}>
              <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">
                {group.label}
              </p>
              <div className="flex flex-col">
                {group.events.map((e, i) => {
                  const meta = TYPE_META[e.type]
                  const Icon = meta.icon
                  return (
                    <div
                      key={`${group.label}-${i}`}
                      className="flex items-start gap-3 border-b border-zinc-200 dark:border-zinc-800 py-3 last:border-b-0 last:pb-0 first:pt-0"
                    >
                      <span className="mt-0.5 w-20 shrink-0 font-mono text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500">
                        {e.time}
                      </span>
                      <div
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${meta.className}`}
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm">
                          <span className="font-medium text-zinc-900 dark:text-zinc-100">{e.name}</span>{' '}
                          <span className="text-zinc-500">{e.action}</span>
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">
                            {e.entity}
                          </span>
                          <Badge
                            variant="outline"
                            className="border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800 text-[10px] font-normal text-zinc-500 dark:text-zinc-400"
                          >
                            {e.client}
                          </Badge>
                        </div>
                      </div>
                      <span className="hidden shrink-0 font-mono text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500 sm:block">
                        {e.user}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
