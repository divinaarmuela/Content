'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLamaReady } from './ready'

// the hidden state is set BEFORE the browser paints, so nothing ever flashes
// in and back out. useLayoutEffect does not exist on the server — React warns
// if it is even referenced during SSR, hence the swap.
const useBeforePaint = typeof window === 'undefined' ? useEffect : useLayoutEffect

// Reference-site reveal. Exact hidden-state recipe observed on the reference:
//   clip-path: inset(-10% -10% 110%); transform: translate(0, 80%) scale(0.96); opacity: 0
// Structure note: the clip/transform live on an INNER div while the OUTER div
// is observed — Chrome's IntersectionObserver reports zero intersection for an
// element fully clipped by its own clip-path, so observing the animated node
// itself would never fire.
export default function Reveal({
  children, className = '', delay = 0, gate = true,
}: {
  children: React.ReactNode
  className?: string
  delay?: number
  /**
   * Wait for the preloader before revealing. True on the homepage, where the
   * loader would otherwise hide the entrance.
   *
   * Pages without a preloader MUST pass false. `lama:ready` never fires there,
   * so the gate falls through to its 3-second safety timeout and the content
   * sits invisible for three seconds — which reads as a page that will not
   * load. Same reason Scramble takes gate={false} on those pages.
   */
  gate?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [seen, setSeen] = useState(false)
  // The server renders the content VISIBLE. Hiding it is a decision the
  // browser makes, before its first paint, and only for blocks that are still
  // below the fold — otherwise the whole page is a blank slab until an
  // IntersectionObserver callback fires after hydration, which on a slow
  // phone is the client's first impression of their portal.
  const [hides, setHides] = useState(false)
  /** the entrance has finished, so the clip that drove it can come off — see
   *  the note on clipPath below for what it breaks if it stays */
  const [settled, setSettled] = useState(false)
  const ready = useLamaReady()
  // the reveal plays only once the preloader is gone, so entrances that are
  // in the first viewport actually animate instead of finishing behind it
  const shown = !hides || (seen && (ready || !gate))

  // Belt and braces for dropping the clip. `transitionend` is the precise
  // signal but it does not fire for a block that was never hidden, and it can
  // be missed if the element is scrolled out mid-transition — either of which
  // would leave the clip on permanently and trap every fixed child inside it.
  useEffect(() => {
    if (!shown) return
    const t = setTimeout(() => setSettled(true), 1400 + delay)
    return () => clearTimeout(t)
  }, [shown, delay])

  useBeforePaint(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setSeen(true); return }
    const el = ref.current
    if (!el) return
    // already on screen → it is content, not an entrance: leave it alone.
    // A GATED page has a preloader covering the first paint, so its hero
    // entrance is still worth playing and nothing is ever seen blank.
    const box = el.getBoundingClientRect()
    if (!gate && box.top < window.innerHeight && box.bottom > 0) { setSeen(true); return }
    setHides(true)
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect() } },
      { threshold: 0.15 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [gate])

  return (
    <div ref={ref} className={className}>
      <div
        onTransitionEnd={() => { if (shown) setSettled(true) }}
        style={{
          transitionDelay: `${delay}ms`,
          /* The clip drives the entrance, and then it MUST go.
           *
           * A non-`none` clip-path makes this div the containing block for any
           * `position: fixed` descendant, and clips it to this box. So anything
           * inside a Reveal that tries to fill the screen — the planning
           * board's fullscreen, a dialog, a dropdown — silently filled this
           * div instead, which looks like the feature is broken rather than
           * like a layout rule. It is only ever needed while the entrance is
           * running, so it is dropped the moment that finishes. */
          clipPath: settled || !hides ? undefined
            : shown ? 'inset(-10% -10% -10%)' : 'inset(-10% -10% 110%)',
          transform: shown ? 'none' : 'translate(0, 80%) scale(0.96)',
          opacity: shown ? 1 : 0,
          // Invisible is not intangible. Hit-testing uses the TRANSFORMED box,
          // so a hidden block sits 80% of its height lower than it looks and
          // covers whatever is beneath it — the nav, a button, a card that has
          // already revealed. Clicks land on nothing until the entrance
          // finishes. Nothing here is meant to be clickable while it is hidden.
          pointerEvents: shown ? undefined : 'none',
          transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
        }}
        className="transition-all duration-[1200ms]"
      >
        {children}
      </div>
    </div>
  )
}
