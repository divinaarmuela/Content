'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CalendarClock, Camera, Send } from 'lucide-react'

/**
 * Production shell: shoots, the calendars they get booked against, and the
 * invitations that book them — three real CHILD ROUTES, not tab state.
 *
 * The layout also wraps the item detail page and a shoot's brief page, which
 * are not views in this switcher. Those render on their own, exactly as they
 * did before, rather than under a header that would lie about where you are.
 */
const VIEWS = [
  {
    href: '/dashboard/production',
    label: 'Shoots',
    icon: Camera,
    blurb: 'Plan the shoot, review the brief, lock the date.',
  },
  {
    href: '/dashboard/production/availability',
    label: 'Availability',
    icon: CalendarClock,
    blurb: 'Google Calendars side by side — empty space is shootable time.',
  },
  {
    href: '/dashboard/production/proposals',
    label: 'Proposals',
    icon: Send,
    blurb: 'Every shoot invitation sent, its status, and the place to call one off.',
  },
]

export default function ProductionLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname()
  const active = VIEWS.find(v => v.href === path)

  if (!active) return <>{children}</>

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Production</h2>
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
