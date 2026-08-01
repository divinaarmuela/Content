'use client'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ExternalLink, CalendarDays } from 'lucide-react'
import type { PortalData, PortalItem } from '../../lib/portal-data'

/** Read-only building blocks shared by the logged-in portal and the
 *  view-only share link. Interactive pieces (approve/comment) live only in
 *  the logged-in page. */

export function CommitmentCards({ data }: { data: PortalData }) {
  const monthName = new Date(2000, (data.commitment?.month ?? new Date().getMonth() + 1) - 1, 1)
    .toLocaleString('en-AU', { month: 'long' })
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold">{monthName} — your content this month</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {!data.commitment || data.commitment.quotas.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No monthly commitment configured yet — your account manager will set this up.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {data.commitment.quotas.map(q => {
              const pct = q.quota === 0 ? 0 : Math.min(100, Math.round((q.published / q.quota) * 100))
              return (
                <div key={q.type} className="rounded-lg border border-zinc-100 p-3 dark:border-zinc-800">
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm font-medium capitalize">{q.type}s</span>
                    <span className="font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                      {q.published}/{q.quota} published
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function PortalItemRow({ item }: { item: PortalItem }) {
  return (
    <div className="flex items-baseline gap-3 rounded-lg border border-zinc-100 px-3 py-2.5 dark:border-zinc-800">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.title}</p>
        <p className="font-mono text-[10px] uppercase text-zinc-400 dark:text-zinc-500">{item.content_type}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {item.schedule.filter(s => s.scheduled_at && !s.live_url).map(s => (
          <span key={s.platform} className="flex items-center gap-1 font-mono text-[10px] uppercase text-zinc-500 dark:text-zinc-400">
            <CalendarDays className="h-3 w-3" />
            {s.platform} · {new Date(s.scheduled_at!).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
          </span>
        ))}
        {item.schedule.filter(s => s.live_url).map(s => (
          <a
            key={s.platform}
            href={s.live_url!}
            target="_blank"
            rel="noreferrer noopener"
            className="flex items-center gap-1 text-xs capitalize text-blue-600 hover:underline dark:text-blue-400"
          >
            {s.platform} <ExternalLink className="h-3 w-3" />
          </a>
        ))}
        <Badge variant="outline" className="font-normal text-zinc-600 dark:text-zinc-400">{item.status_label}</Badge>
      </div>
    </div>
  )
}

export function PortalSection({ title, items, empty }: { title: string; items: PortalItem[]; empty: string }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm font-semibold">{title}</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-2 pt-0">
        {items.length === 0
          ? <p className="text-sm text-zinc-400 dark:text-zinc-500">{empty}</p>
          : items.map(i => <PortalItemRow key={i.id} item={i} />)}
      </CardContent>
    </Card>
  )
}
