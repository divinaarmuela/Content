import Link from 'next/link'
import { PORTAL_TABS, onePortalPath, type PortalTab } from '../../lib/one-portal-core'

/**
 * THE ONE PORTAL'S TABS (docs/ONE_PORTAL_SPEC.md §3): Shoot brief · Editing · Designing · Scheduling, as plain
 * links so every email can open one (`?tab=`), with a count of what is waiting on the client in each.
 * Sits in the sticky strip; scrolls sideways on a phone rather than wrapping.
 */
export default function OnePortalTabs({ token, active, waiting }: {
  token: string
  active: PortalTab
  waiting: Record<PortalTab, number>
}) {
  return (
    // ONE ROW, SWIPED, EDGE TO EDGE ON A PHONE (the owner, 2 Oct 2026: "the horizontal scroll of the pills is weird"): no
    // scrollbar drawn, the row runs to the screen's edge, and a fade at the right says there are more tabs to swipe to
    <div className="relative -mx-5 sm:mx-0">
    <nav aria-label="Your portal" className="flex gap-1.5 overflow-x-auto overscroll-x-contain scroll-px-5 px-5 py-2 [scrollbar-width:none] sm:px-0 [&::-webkit-scrollbar]:hidden" data-one-portal-tabs>
      {PORTAL_TABS.map(t => {
        const on = t.key === active
        const n = waiting[t.key] ?? 0
        return (
          <Link
            key={t.key}
            href={onePortalPath(token, t.key)}
            aria-current={on ? 'page' : undefined}
            className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full border px-4 text-[13px] font-semibold transition-colors ${
              on ? 'border-foreground bg-foreground text-background' : 'border-border hover:bg-muted'
            }`}
          >
            {t.label}
            {n > 0 && (
              <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] tabular-nums ${on ? 'bg-background text-foreground' : 'bg-foreground text-background'}`}
                aria-label={`${n} waiting on you`}>
                {n}
              </span>
            )}
          </Link>
        )
      })}
      {/* the last tab clears the fade */}
      <span aria-hidden className="w-6 shrink-0 sm:hidden" />
    </nav>
    <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background to-transparent sm:hidden" />
    </div>
  )
}
