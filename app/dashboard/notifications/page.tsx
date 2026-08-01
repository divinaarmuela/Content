'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import {
  CalendarClock,
  CheckCheck,
  CheckCircle2,
  FileText,
  MessageSquare,
  TrendingUp,
  UserPlus,
} from 'lucide-react'

type NotificationType =
  | 'approval'
  | 'comment'
  | 'schedule'
  | 'report'
  | 'performance'
  | 'team'

type Notification = {
  id: number
  type: NotificationType
  title: string
  detail: string
  time: string
  unread: boolean
}

const ICONS: Record<NotificationType, typeof CheckCircle2> = {
  approval: CheckCircle2,
  comment: MessageSquare,
  schedule: CalendarClock,
  report: FileText,
  performance: TrendingUp,
  team: UserPlus,
}

const ICON_STYLES: Record<NotificationType, string> = {
  approval: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
  comment: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
  schedule: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
  report: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
  performance: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
  team: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
}

const DEMO_NOTIFICATIONS: Notification[] = [
  {
    id: 1,
    type: 'approval',
    title: 'Harbourline Cafe approved the June content calendar',
    detail: 'All 12 posts cleared for scheduling.',
    time: '2026-07-31 09:14',
    unread: true,
  },
  {
    id: 2,
    type: 'comment',
    title: 'New comment on "Winter menu launch" brief',
    detail: 'Sasha left feedback on the hero shot list.',
    time: '2026-07-31 08:42',
    unread: true,
  },
  {
    id: 3,
    type: 'schedule',
    title: 'Shoot reminder: Coastal Fitness, tomorrow 10:00',
    detail: 'On-location at the Bondi studio.',
    time: '2026-07-30 17:05',
    unread: true,
  },
  {
    id: 4,
    type: 'performance',
    title: 'Reel passed 50k views for Verde Skincare',
    detail: 'Best performing post this month.',
    time: '2026-07-30 12:31',
    unread: false,
  },
  {
    id: 5,
    type: 'report',
    title: 'June performance report is ready to send',
    detail: 'Awaiting final review before client delivery.',
    time: '2026-07-29 16:20',
    unread: false,
  },
  {
    id: 6,
    type: 'team',
    title: 'Priya joined the workspace',
    detail: 'Added as an editor by Marcus.',
    time: '2026-07-28 10:03',
    unread: false,
  },
]

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState(DEMO_NOTIFICATIONS)
  const unreadCount = notifications.filter((n) => n.unread).length

  const markAllRead = () => {
    setNotifications((current) => current.map((n) => ({ ...n, unread: false })))
    toast.success('All notifications marked as read')
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Notifications</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {unreadCount > 0
              ? `${unreadCount} unread across your workspace.`
              : 'You are all caught up.'}
          </p>
        </div>
        <Badge
          variant="outline"
          className="ml-auto font-mono text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500"
        >
          Demo data
        </Badge>
        <Button
          variant="outline"
          size="sm"
          onClick={markAllRead}
          disabled={unreadCount === 0}
        >
          <CheckCheck className="h-4 w-4" />
          Mark all read
        </Button>
      </div>

      <Card className="border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <CardContent className="p-0">
          {notifications.map((notification, index) => {
            const Icon = ICONS[notification.type]
            return (
              <div key={notification.id}>
                {index > 0 && <Separator className="bg-zinc-200 dark:bg-zinc-800" />}
                <div className="flex items-start gap-3 px-4 py-3.5">
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${ICON_STYLES[notification.type]}`}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {notification.title}
                      </p>
                      {notification.unread && (
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-600" />
                      )}
                    </div>
                    <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
                      {notification.detail}
                    </p>
                  </div>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-zinc-400 dark:text-zinc-500">
                    {notification.time}
                  </span>
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>
    </div>
  )
}
