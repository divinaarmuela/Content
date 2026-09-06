'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CalendarDays, Kanban, Send } from 'lucide-react'
import NewPostButton from './NewPostButton'
import PageTitle from '../ui/PageTitle'
import { SCHEDULE_PAGE } from '../../lib/page-access-core'

/**
 * Scheduler shell: the views are real CHILD ROUTES, not tab state —
 * /dashboard/scheduler (the board) and /scheduler/calendar. A refresh keeps
 * you on the view you were on, the URL is shareable, and the back button
 * means something. The Schedule page — the posting calendar under Social —
 * sits beside them as a link, because it is the other half of a scheduler's
 * day. Availability and Proposals live on Production: booking a shoot is
 * pre-production work, not posting work.
 */
const VIEWS = [
  {
    href: '/dashboard/scheduler',
    label: 'Board',
    icon: Kanban,
    blurb: 'Every card, Draft to Posted — what needs doing and the link. Post it on the Schedule page, then mark the card Booked in, then Posted.',
  },
  {
    href: '/dashboard/scheduler/calendar',
    label: 'Posting calendar',
    icon: CalendarDays,
    blurb: 'Every post on the day it goes out, and whether it actually did.',
  },
]

export default function SchedulerLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname()
  const active = VIEWS.find(v => v.href === path) ?? VIEWS[0]
  const pill = (isActive: boolean) =>
    `inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full px-4 text-[14px] font-semibold transition-colors ${
      isActive ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
    }`

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Scheduler"
        summary={active.blurb}
        actions={<>
          {/* link pills, on the page's own pill rail */}
          <nav aria-label="Scheduler views"
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface p-1">
            {VIEWS.map(v => {
              const Icon = v.icon
              const isActive = v.href === active.href
              return (
                <Link key={v.href} href={v.href} aria-current={isActive ? 'page' : undefined} className={pill(isActive)}>
                  <Icon className="h-4 w-4" strokeWidth={1.8} /> {v.label}
                </Link>
              )
            })}
            {/* the posting calendar with the composer — the page a scheduler
                books real posts on, one pill away rather than a sidebar hunt */}
            <Link href={SCHEDULE_PAGE} className={pill(false)}>
              <Send className="h-4 w-4" strokeWidth={1.8} /> Schedule
            </Link>
          </nav>

          {/* posting is decided here, so starting one belongs here — the same
              composer the Social page opens, not a second one to keep in step */}
          <NewPostButton />
        </>}
      />

      {children}
    </div>
  )
}
