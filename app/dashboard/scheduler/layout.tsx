'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CalendarDays, ListChecks } from 'lucide-react'
import NewPostButton from './NewPostButton'
import PageTitle from '../ui/PageTitle'

/**
 * Scheduler shell: the views are real CHILD ROUTES, not tab state —
 * /dashboard/scheduler (queue) and /scheduler/calendar. A refresh keeps you on
 * the view you were on, the URL is shareable, and the back button means
 * something. Availability and Proposals live on Production now: booking a
 * shoot is pre-production work, not posting work.
 */
const VIEWS = [
  {
    href: '/dashboard/scheduler',
    label: 'Queue',
    icon: ListChecks,
    blurb: 'Signed-off items waiting for a posting time. Take one, open it, set the platform and the time.',
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
                <Link
                  key={v.href}
                  href={v.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={`inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full px-4 text-[14px] font-semibold transition-colors ${
                    isActive
                      ? 'bg-foreground text-background'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Icon className="h-4 w-4" strokeWidth={1.8} /> {v.label}
                </Link>
              )
            })}
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
