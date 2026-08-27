'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  ArrowRight, Bell, BellOff, CalendarClock, CheckCircle2, ClipboardList,
  FileText, MessageSquare, UserPlus, XCircle,
} from 'lucide-react'
import { eventWords, notificationHref, EMAIL_FAILED_WORDS } from '@/app/lib/notification-words'
import { LoadFailed } from '../NotSetUp'
import HelpHint from '../HelpHint'

/**
 * The person's real notification history — the same rows the email outbox
 * wrote, so this page can never disagree with their inbox. Every row links
 * to the thing it was about.
 */

type Row = {
  id: string
  event_type: string
  subject: string
  status: string
  entity_type: string
  entity_id: string
  created_at: string
  read_at?: string | null
}

const ICON = (eventType: string) => {
  if (eventType === 'job_assigned') return ClipboardList
  if (eventType.startsWith('transition_')) return CheckCircle2
  if (eventType === 'client_comment' || eventType === 'comment_assigned' || eventType === 'approval_note') return MessageSquare
  if (eventType === 'due_reminder') return CalendarClock
  if (eventType.startsWith('shoot_') || eventType.startsWith('batch_')) return CalendarClock
  if (eventType === 'prospect_auto_ingested') return UserPlus
  if (eventType.startsWith('intake')) return FileText
  return Bell
}

/** Where a notification points. Every entity type has a destination now. */
const linkFor = (r: Row): string | null => notificationHref(r.entity_type, r.entity_id)

const when = (iso: string) => {
  const d = new Date(iso)
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000)
  if (days === 0) return d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })
  if (days === 1) return 'yesterday'
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}

export default function NotificationsPage() {
  const [rows, setRows] = useState<Row[] | null>(null)
  // a server outage used to render as "Nothing yet", which is a lie about
  // the state of the world, not a display bug
  const [failed, setFailed] = useState<string | null>(null)

  const load = useCallback(async () => {
    setFailed(null)
    try {
      const res = await fetch('/api/team/notifications')
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
      setRows((await res.json()).notifications ?? [])
      // seen = read: the badge clears, but rows keep their unread tint for
      // this visit so what was new is still visible
      void fetch('/api/team/notifications', { method: 'POST' }).catch(() => {})
    } catch (e) {
      console.error('[notifications] load failed', e)
      setFailed(e instanceof Error ? e.message : 'unknown')
      setRows(null)
    }
  }, [])
  useEffect(() => { load() }, [load])

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Notifications</h2>
        <p className="flex flex-wrap items-center text-sm text-zinc-500 dark:text-zinc-400">
          Everything we have sent you — the same record as your email inbox.
          Every row opens the item
          <HelpHint term="item" />
          or shoot
          <HelpHint term="shoot" />
          it is about.
        </p>
      </div>

      {failed ? (
        <LoadFailed what="your notifications" detail={failed} onRetry={() => load()} />
      ) : rows === null ? (
        <Card><CardContent className="flex flex-col gap-3 p-6">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </CardContent></Card>
      ) : rows.length === 0 ? (
        <Card className="border-dashed shadow-none">
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
            <BellOff className="h-6 w-6 text-zinc-300 dark:text-zinc-600" />
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Nothing yet — you&rsquo;ll see review requests, assignments, approvals, and reminders here as they happen.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="py-0">
          <CardContent className="flex flex-col divide-y divide-zinc-100 p-0 dark:divide-zinc-800">
            {rows.map(r => {
              const Icon = ICON(r.event_type)
              const href = linkFor(r)
              const inner = (
                <div className="flex items-center gap-3 px-4 py-3">
                  {!r.read_at
                    ? <span className="h-2 w-2 shrink-0 rounded-full bg-blue-500" aria-label="unread" />
                    : <span className="h-2 w-2 shrink-0" />}
                  <Icon className="h-4 w-4 shrink-0 text-zinc-400 dark:text-zinc-500" />
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm ${r.read_at ? '' : 'font-medium'}`}>{r.subject}</p>
                    {/* the raw enum used to sit here in mono uppercase:
                        "transition internal review", "prospect auto ingested" */}
                    {eventWords(r.event_type) && (
                      <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                        {eventWords(r.event_type)}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {r.status === 'failed' && (
                      <Badge variant="outline" className="gap-1 border-red-200 bg-red-50 font-normal text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">
                        <XCircle className="h-3 w-3" />
                        <span className="hidden sm:inline">{EMAIL_FAILED_WORDS}</span>
                        <span className="sm:hidden">Not delivered</span>
                      </Badge>
                    )}
                    <span className="font-mono text-[11px] text-zinc-400 dark:text-zinc-500">{when(r.created_at)}</span>
                    {href && <ArrowRight className="h-3.5 w-3.5 text-zinc-300 dark:text-zinc-600" />}
                  </div>
                </div>
              )
              return href
                ? <Link key={r.id} href={href} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/60">{inner}</Link>
                : <div key={r.id}>{inner}</div>
            })}
          </CardContent>
        </Card>
      )}

      {rows !== null && rows.length > 0 && (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => load()}>Refresh</Button>
        </div>
      )}
    </div>
  )
}
