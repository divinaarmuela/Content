'use client'

import { usePathname } from 'next/navigation'
import PageTitle from '../ui/PageTitle'

/**
 * Production shell. The board is the page — it opens straight on the work,
 * with no tab strip above it. (There used to be a Shoots / Availability /
 * Proposals switcher here; the owner found it in the way, so it went.)
 *
 * Availability and Proposals still exist as routes, reached by a direct
 * link or from the shoot page, and each still needs the heading this layout
 * drew for it. The board writes its own — it is the only view that can
 * count what is on it — so it gets bare children, as do the item page and a
 * shoot's page.
 */
const TITLED: Record<string, string> = {
  '/dashboard/production/availability':
    'Google Calendars side by side — empty space is shootable time.',
  '/dashboard/production/proposals':
    'Every shoot invitation sent, its status, and the place to call one off.',
}

export default function ProductionLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname()
  const blurb = TITLED[path]

  if (!blurb) return <>{children}</>

  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Production" summary={blurb} />
      {children}
    </div>
  )
}
