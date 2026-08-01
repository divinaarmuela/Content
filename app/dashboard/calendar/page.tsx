'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

type Status = 'live' | 'scheduled' | 'approved' | 'draft'
interface Post { title: string; client: string; status: Status }

const POSTS: Record<number, Post[]> = {
  2:  [{ title: 'Apex — Reel',         client: 'AF', status: 'live' }],
  3:  [{ title: 'Bloom — Carousel',    client: 'BS', status: 'live' }],
  5:  [{ title: 'Vertex — Post',       client: 'VL', status: 'live' }],
  8:  [{ title: 'Surge — Reel',        client: 'SC', status: 'live' }],
  9:  [{ title: 'Bloom — Story',       client: 'BS', status: 'live' }, { title: 'Align — Post', client: 'AW', status: 'live' }],
  10: [{ title: 'Apex — Ad',           client: 'AF', status: 'approved' }],
  12: [{ title: 'Nova — Carousel',     client: 'NB', status: 'approved' }],
  14: [{ title: 'Surge — Campaign',    client: 'SC', status: 'scheduled' }],
  15: [{ title: 'Apex — Reel series',  client: 'AF', status: 'scheduled' }, { title: 'Vertex — LI', client: 'VL', status: 'approved' }],
  16: [{ title: 'Bloom — Summer',      client: 'BS', status: 'scheduled' }],
  17: [{ title: 'Align — Draft',       client: 'AW', status: 'draft' }],
  18: [{ title: 'Nova — Launch',       client: 'NB', status: 'scheduled' }],
  20: [{ title: 'Surge — Menu',        client: 'SC', status: 'scheduled' }],
  22: [{ title: 'Align — Ep3',         client: 'AW', status: 'scheduled' }],
  24: [{ title: 'Apex — Paid ad',      client: 'AF', status: 'draft' }],
  27: [{ title: 'Bloom — Post',        client: 'BS', status: 'draft' }],
  30: [{ title: 'EOM recap',           client: 'VL', status: 'draft' }],
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const FILTERS: { label: string; value: Status }[] = [
  { label: 'Live',      value: 'live' },
  { label: 'Scheduled', value: 'scheduled' },
  { label: 'Approved',  value: 'approved' },
  { label: 'Draft',     value: 'draft' },
]

const PILL_CLASSES: Record<Status, string> = {
  live:      'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
  scheduled: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
  approved:  'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
  draft:     'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
}

// Fixed demo month so SSR and client render identically.
const DEMO_MONTH = new Date(2026, 5, 1) // June 2026
const TODAY = 17

export default function CalendarPage() {
  const [activeFilters, setActiveFilters] = useState<Status[]>([])

  const year = DEMO_MONTH.getFullYear()
  const month = DEMO_MONTH.getMonth()
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  const toggle = (s: Status) =>
    setActiveFilters(f => (f.includes(s) ? f.filter(x => x !== s) : [...f, s]))

  const visible = (day: number) => {
    const posts = POSTS[day] ?? []
    return activeFilters.length === 0 ? posts : posts.filter(p => activeFilters.includes(p.status))
  }

  const upcoming = Object.entries(POSTS)
    .filter(([d]) => Number(d) >= TODAY)
    .sort(([a], [b]) => Number(a) - Number(b))
    .slice(0, 8)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Publishing Calendar</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">June 2026 content schedule across all clients.</p>
        </div>
        <Badge variant="outline" className="ml-auto font-mono text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
          Demo data
        </Badge>
        <Button size="sm" onClick={() => toast.success('Post scheduled', { description: 'Publishing queue updated.' })}>
          <Plus className="h-4 w-4" />
          Schedule post
        </Button>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <Card className="min-w-0 flex-1 border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <CardHeader className="flex flex-row flex-wrap items-center gap-3 space-y-0 p-4">
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => toast('Demo month only')}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="font-mono text-sm tabular-nums text-zinc-900 dark:text-zinc-100">June 2026</span>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => toast('Demo month only')}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <div className="ml-auto flex flex-wrap gap-1.5">
              {FILTERS.map(f => (
                <button
                  key={f.value}
                  onClick={() => toggle(f.value)}
                  className={`rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
                    activeFilters.includes(f.value)
                      ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                      : 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/60'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
              <div className="grid grid-cols-7 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
                {DAYS.map(d => (
                  <div key={d} className="px-2 py-1.5 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">
                    {d}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {cells.map((day, i) => (
                  <div
                    key={i}
                    className={`min-h-20 border-b border-r border-zinc-200 dark:border-zinc-800 p-1.5 [&:nth-child(7n)]:border-r-0 ${
                      day === null ? 'bg-zinc-50 dark:bg-zinc-800/40' : 'bg-white dark:bg-zinc-900'
                    }`}
                  >
                    {day !== null && (
                      <>
                        <span
                          className={`mb-1 inline-flex h-5 w-5 items-center justify-center rounded-full font-mono text-[11px] tabular-nums ${
                            day === TODAY ? 'bg-zinc-900 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900' : 'text-zinc-500 dark:text-zinc-400'
                          }`}
                        >
                          {day}
                        </span>
                        <div className="flex flex-col gap-1">
                          {visible(day).map((p, j) => (
                            <span
                              key={j}
                              className={`truncate rounded px-1.5 py-0.5 text-[10px] font-medium ${PILL_CLASSES[p.status]}`}
                            >
                              {p.title}
                            </span>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="w-full shrink-0 border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 lg:w-56">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">
              Upcoming
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 p-4 pt-1">
            {upcoming.map(([day, posts]) => (
              <div key={day}>
                <p className="mb-1 font-mono text-[10px] tabular-nums uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">
                  Jun {day}
                </p>
                <div className="flex flex-col gap-1">
                  {posts.map((p, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <span className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] ${PILL_CLASSES[p.status]}`}>
                        {p.client}
                      </span>
                      <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                        {p.title.split('—')[1]?.trim() ?? p.title}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
