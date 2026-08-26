'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CalendarDays, ListChecks } from 'lucide-react'

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
    blurb: 'Only client-approved content appears here. Open an item to set platforms, dates, and live links.',
  },
  {
    href: '/dashboard/scheduler/calendar',
    label: 'Calendar',
    icon: CalendarDays,
    blurb: 'Everything with a date, and whether it actually went out.',
  },
]

export default function SchedulerLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname()
  const active = VIEWS.find(v => v.href === path) ?? VIEWS[0]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Scheduler</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{active.blurb}</p>
        </div>

        {/* link pills styled like the shadcn TabsList they replace */}
        <nav className="ml-auto inline-flex h-9 items-center justify-center rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800">
          {VIEWS.map(v => {
            const Icon = v.icon
            const isActive = v.href === active.href
            return (
              <Link
                key={v.href}
                href={v.href}
                aria-current={isActive ? 'page' : undefined}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-white text-zinc-950 shadow-sm dark:bg-zinc-950 dark:text-zinc-50'
                    : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
                }`}
              >
                <Icon className="h-3.5 w-3.5" /> {v.label}
              </Link>
            )
          })}
        </nav>
      </div>

      {children}
    </div>
  )
}
