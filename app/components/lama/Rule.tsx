'use client'

import { useEffect, useRef } from 'react'

// Scroll-scrubbed rule (lamalama about-us core values): scaleX tracks the
// line's position in the viewport — 0 as it enters at the bottom, fully
// drawn by the time it has risen to ~65% of the screen, reversing when
// you scroll back up. Updated per frame from getBoundingClientRect, so it
// stays correct inside sticky stacking cards. No one-shot animation.
export default function Rule({ className = 'bg-cream' }: { className?: string }) {
  const outerRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = outerRef.current
    const bar = barRef.current
    if (!el || !bar) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      bar.style.transform = 'scaleX(1)'
      return
    }
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const top = el.getBoundingClientRect().top
      const vh = window.innerHeight
      const p = Math.min(1, Math.max(0, (vh - top) / (vh * 0.65)))
      bar.style.transform = `scaleX(${p})`
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div ref={outerRef} aria-hidden="true" className="w-full">
      <div ref={barRef} className={`h-0.5 origin-left ${className}`} style={{ transform: 'scaleX(0)' }} />
    </div>
  )
}
