'use client'

import { usePathname } from 'next/navigation'
import SiteHeader from './SiteHeader'

/**
 * The home page has its own nav baked into the full-screen film hero
 * (overlaid on the video with a blend mode), so the global header is
 * suppressed there and rendered on every other route.
 */
export default function SiteHeaderGate() {
  const pathname = usePathname()
  if (pathname === '/') return null
  return <SiteHeader />
}
