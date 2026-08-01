'use client'

import { usePathname } from 'next/navigation'
import SiteNav from './SiteNav'
import SmoothScroll from './SmoothScroll'

export default function SiteShell({ children }: { children: React.ReactNode }) {
  const path = usePathname()
  const isShell = path.startsWith('/dashboard') || path.startsWith('/sign-in') || path.startsWith('/sign-up') || path.startsWith('/client') || path.startsWith('/portal')

  if (isShell) return <>{children}</>

  // the redesigned homepage and the dark case study pages bring their own
  // nav (LamaNav) — skip the global paper one there
  const isLamaHome = path === '/' || /^\/work\/.+/.test(path)

  return (
    <>
      <SmoothScroll />
      {!isLamaHome && <SiteNav />}
      {children}
    </>
  )
}
