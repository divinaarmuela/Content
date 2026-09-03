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
    blurb: 'Create a shoot plan, get it signed off, then book the date.',
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
        {/* the board writes its own heading — it is the only view that can
            count what is on it. The other two still need one here. */}
        {active.href !== '/dashboard/production' && (
          <div>
            <h2 className="text-[19px] font-semibold tracking-tight">Production</h2>
            <p className="text-[15px] text-muted-foreground">{active.blurb}</p>
          </div>
        )}

        {/* link pills, the same white group the scope switch wears */}
        <nav className="ml-auto inline-flex items-center justify-center gap-1.5 rounded-full border border-border bg-surface p-1">
          {VIEWS.map(v => {
            const Icon = v.icon
            const isActive = v.href === active.href
            return (
              <Link
                key={v.href}
                href={v.href}
                aria-current={isActive ? 'page' : undefined}
                className={`inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-full px-4 text-[14px] font-semibold transition-colors ${
                  isActive
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="h-4 w-4" /> {v.label}
              </Link>
            )
          })}
        </nav>
      </div>

      {children}
    </div>
  )
}
