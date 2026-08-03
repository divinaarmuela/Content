'use client'

import { useEffect, useRef, useState } from 'react'

// Growing rule, two modes:
// - default: scroll-scrubbed — scaleX tracks the line's position in the
//   viewport per frame (0 entering at the bottom, 1 by ~65% up), reversing
//   on scroll-up.
// - once: one-shot entrance — grows to full width the first time it comes
//   into view and stays (the team-list treatment: lines are already grown
//   when you arrive at the rows).
// Reduced motion renders the line full-width immediately in both modes.
export default function Rule({ className = 'bg-cream', once = false }: { className?: string; once?: boolean }) {
  const outerRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const [seen, setSeen] = useState(false)

  useEffect(() => {
    const el = outerRef.current
    const bar = barRef.current
    if (!el || !bar) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      bar.style.transform = 'scaleX(1)'
      setSeen(true)
      return
    }
    if (once) {
      const io = new IntersectionObserver(
        ([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect() } },
        { rootMargin: '0px 0px -5% 0px' },
      )
      io.observe(el)
      return () => io.disconnect()
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
  }, [once])

  return (
    <div ref={outerRef} aria-hidden="true" className="w-full">
      <div
        ref={barRef}
        className={`h-0.5 origin-left ${once ? `transition-transform duration-[900ms] ease-[cubic-bezier(0.33,1,0.68,1)] ${seen ? 'scale-x-100' : 'scale-x-0'}` : ''} ${className}`}
        style={once ? undefined : { transform: 'scaleX(0)' }}
      />
    </div>
  )
}
