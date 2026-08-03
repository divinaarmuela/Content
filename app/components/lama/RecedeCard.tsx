'use client'

import { useEffect, useRef } from 'react'

// The lusion featured-work depth handoff: the current card pins, and as
// the NEXT card scrolls up over it the pinned one recedes — scales down,
// pushes back in Z, dims — so both are visible mid-transition, one
// sinking behind the other. The recede is scrubbed off the next card's
// viewport position per frame (reverses on scroll-up). Desktop only; on
// mobile the cards are plain flow.
//
// Structure contract: all RecedeCards are DIRECT siblings inside one
// relative stack container — that shared containing block is what lets a
// card stay pinned until the next one covers it. `next` is simply the
// next sibling card.
const TOP_VH = 0.1 // sticky offset as a fraction of viewport height

export default function RecedeCard({ children, isLast = false }: { children: React.ReactNode; isLast?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || isLast) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const lg = window.matchMedia('(min-width: 1024px)')
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      if (!lg.matches) { el.style.transform = ''; el.style.opacity = ''; return }
      const next = el.nextElementSibling
      if (!next) return
      const nextTop = next.getBoundingClientRect().top
      const vh = window.innerHeight
      const topPx = vh * TOP_VH
      // recede only while actually being covered: 0 until the incoming
      // card's top touches this card's bottom edge, 1 once it reaches the
      // pin line. offsetHeight, not rect height — the rect shrinks as the
      // card scales, which would feed back into the progress.
      const pinBottom = topPx + el.offsetHeight
      const p = Math.min(1, Math.max(0, (pinBottom - nextTop) / (pinBottom - topPx)))
      el.style.transform = `translateZ(${-320 * p}px) scale(${1 - 0.12 * p})`
      el.style.opacity = `${1 - 0.6 * p}`
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [isLast])

  return (
    <div
      ref={ref}
      className="mb-6 will-change-transform lg:sticky lg:top-[10vh] lg:mb-[14vh] [transform-origin:50%_20%]"
    >
      {children}
    </div>
  )
}
