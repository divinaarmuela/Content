'use client'

import { usePathname } from 'next/navigation'
import SiteNav from './SiteNav'
import SmoothScroll from './SmoothScroll'

export default function SiteShell({ children }: { children: React.ReactNode }) {
  const path = usePathname()
  const isShell = path.startsWith('/dashboard') || path.startsWith('/sign-in') || path.startsWith('/sign-up') || path.startsWith('/client')

  if (isShell) return <>{children}</>

  // the redesigned homepage brings its own nav (LamaNav) — skip the global one there
  const isLamaHome = path === '/'

  return (
    <>
      <SmoothScroll />
      {!isLamaHome && <SiteNav />}
      {children}
    </>
  )
}
