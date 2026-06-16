'use client'

import { useEffect } from 'react'
import Lenis from 'lenis'

/**
 * Site-wide smooth scrolling via Lenis. Lenis animates the NATIVE scroll
 * position (it doesn't hijack scroll with transforms), so `position: sticky`
 * and the hero's CSS `scroll()` timeline keep working.
 */
export default function SmoothScroll() {
  useEffect(() => {
    // respect users who prefer reduced motion — leave native scrolling
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    // disable on macOS and iOS — native inertia scrolling is already smooth
    const ua = navigator.userAgent
    const isMac = /Macintosh/.test(ua) && !('ontouchstart' in window)
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    if (isMac || isIOS) return

    const lenis = new Lenis({
      duration: 0.65,
      easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
    })

    // expose so transitions (e.g. SilkTransition) can pause/resume smooth scroll
    ;(window as unknown as { __lenis?: Lenis }).__lenis = lenis

    let rafId = 0
    function raf(time: number) {
      lenis.raf(time)
      rafId = requestAnimationFrame(raf)
    }
    rafId = requestAnimationFrame(raf)

    return () => {
      cancelAnimationFrame(rafId)
      lenis.destroy()
      delete (window as unknown as { __lenis?: Lenis }).__lenis
    }
  }, [])

  return null
}
