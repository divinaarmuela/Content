'use client'

import { usePathname } from 'next/navigation'
import SiteNav from './SiteNav'
import SmoothScroll from './SmoothScroll'

export default function SiteShell({ children }: { children: React.ReactNode }) {
  const path = usePathname()
  const isShell = path.startsWith('/dashboard') || path.startsWith('/sign-in') || path.startsWith('/sign-up') || path.startsWith('/sso-callback') || path.startsWith('/client')

  if (isShell) return <>{children}</>

  return (
    <>
      <SmoothScroll />
      <SiteNav />
      {children}
    </>
  )
}
