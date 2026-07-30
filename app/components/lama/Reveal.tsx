'use client'

import { useEffect, useRef, useState } from 'react'
import { useLamaReady } from './ready'

// Reference-site reveal. Exact hidden-state recipe observed on the reference:
//   clip-path: inset(-10% -10% 110%); transform: translate(0, 80%) scale(0.96); opacity: 0
// Structure note: the clip/transform live on an INNER div while the OUTER div
// is observed — Chrome's IntersectionObserver reports zero intersection for an
// element fully clipped by its own clip-path, so observing the animated node
// itself would never fire.
export default function Reveal({
  children, className = '', delay = 0,
}: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [seen, setSeen] = useState(false)
  const ready = useLamaReady()
  // the reveal plays only once the preloader is gone, so entrances that are
  // in the first viewport actually animate instead of finishing behind it
  const shown = seen && ready

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setSeen(true); return }
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect() } },
      { threshold: 0.15 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <div ref={ref} className={className}>
      <div
        style={{
          transitionDelay: `${delay}ms`,
          clipPath: shown ? 'inset(-10% -10% -10%)' : 'inset(-10% -10% 110%)',
          transform: shown ? 'none' : 'translate(0, 80%) scale(0.96)',
          opacity: shown ? 1 : 0,
          transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
        }}
        className="transition-all duration-[1200ms]"
      >
        {children}
      </div>
    </div>
  )
}
