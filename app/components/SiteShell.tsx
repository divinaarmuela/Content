'use client'

import { usePathname } from 'next/navigation'
import SmoothScroll from './SmoothScroll'

/**
 * Global chrome for the public site.
 *
 * It deliberately does NOT render the nav. The nav used to live here and be
 * subtracted on the routes that bring their own (the homepage, the case
 * studies), which made page structure depend on a client-side hook — and any
 * route where that check did not hold rendered two navs at once. Each page
 * now opts in to the nav it wants, so a nav cannot appear somewhere it was
 * never asked for.
 */
export default function SiteShell({ children }: { children: React.ReactNode }) {
  const path = usePathname()
  const isAppShell =
    path.startsWith('/dashboard') ||
    path.startsWith('/sign-in') ||
    path.startsWith('/sign-up') ||
    path.startsWith('/client') ||
    path.startsWith('/portal')

  if (isAppShell) return <>{children}</>

  return (
    <>
      <SmoothScroll />
      {children}
    </>
  )
}
