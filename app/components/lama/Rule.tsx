'use client'

import { useEffect, useRef, useState } from 'react'
import { useLamaReady } from './ready'

// Reference-site growing hairline (lamalama.com/about-us core values): a
// 1px rule that scales from 0 to full width, origin left, the first time
// it scrolls into view after the preloader. Structure note: the OUTER div
// is observed while the INNER div carries the scale — a scaleX(0) element
// paints nothing, so observing the animated node itself would never fire
// (same recipe as Reveal).
export default function Rule({ className = 'bg-cream/[0.22]', delay = 0 }: { className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [seen, setSeen] = useState(false)
  const ready = useLamaReady()
  const shown = seen && ready

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setSeen(true); return }
    const el = ref.current
    if (!el) return
    // fire only once the line is 15% up from the bottom edge, so the growth
    // actually plays on screen instead of finishing below the fold
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect() } },
      { rootMargin: '0px 0px -15% 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <div ref={ref} aria-hidden="true" className="h-px w-full">
      <div
        className={`h-px origin-left transition-transform duration-[1600ms] ease-[cubic-bezier(0.33,1,0.68,1)] motion-reduce:transition-none ${shown ? 'scale-x-100' : 'scale-x-0'} ${className}`}
        style={delay ? { transitionDelay: `${delay}ms` } : undefined}
      />
    </div>
  )
}
