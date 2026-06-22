'use client'

import { useEffect, useRef } from 'react'

/**
 * Reusable version of the homepage GradientHero: electric-blue aurora background,
 * film grain, and the Sui-style masked headline — edge words blurred, middle
 * sharp, and the full phrase revealed in sharp white inside a cursor-following
 * blob. Pass the headline split into `lead` / `mid` / `trail` segments (their
 * concatenation, including spaces and any <br/>, is the full phrase).
 */
export default function GlowHero({
  tag,
  lead,
  mid,
  trail,
  desc,
  actions,
}: {
  tag: string
  lead: React.ReactNode
  mid: React.ReactNode
  trail: React.ReactNode
  desc: React.ReactNode
  actions: React.ReactNode
}) {
  const h1Ref = useRef<HTMLHeadingElement>(null)
  const sharpRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const h1 = h1Ref.current
    const sharp = sharpRef.current
    if (!h1 || !sharp) return

    // real pointers only — on touch there's no cursor and the CSS hides the blob
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return

    let rect = sharp.getBoundingClientRect()
    const refreshRect = () => { rect = sharp.getBoundingClientRect() }

    // coalesce moves to one mask update per frame
    let raf = 0
    let mx = 0, my = 0
    const apply = () => {
      raf = 0
      sharp.style.setProperty('--mx', `${mx - rect.left}px`)
      sharp.style.setProperty('--my', `${my - rect.top}px`)
    }
    const onMove = (e: MouseEvent) => {
      mx = e.clientX; my = e.clientY
      if (!raf) raf = requestAnimationFrame(apply)
    }

    h1.addEventListener('mousemove', onMove)
    window.addEventListener('scroll', refreshRect, { passive: true })
    window.addEventListener('resize', refreshRect)
    return () => {
      h1.removeEventListener('mousemove', onMove)
      window.removeEventListener('scroll', refreshRect)
      window.removeEventListener('resize', refreshRect)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <section className="hero-glow svc-glow">
      <div className="hero-glow-bg" aria-hidden="true" />
      <div className="filmhero-grain" aria-hidden="true" />

      <div className="hero-glow-inner">
        <p className="hero-glow-tag">{tag}</p>

        <div className="gh-headline-zone">
          <h1 ref={h1Ref} className="hero-glow-h1">
            {/* base: edge words sharp-blurred, middle hidden */}
            <span className="hl-layer hl-base">
              {lead}<span className="hl-hide">{mid}</span>{trail}
            </span>
            {/* middle sharp, edges hidden */}
            <span className="hl-layer hl-mid" aria-hidden="true">
              <span className="hl-hide">{lead}</span>{mid}<span className="hl-hide">{trail}</span>
            </span>
            {/* full phrase sharp, revealed only inside the cursor blob */}
            <span ref={sharpRef} className="hl-layer hl-blob" aria-hidden="true">
              {lead}{mid}{trail}
            </span>
          </h1>
        </div>

        <p className="hero-glow-desc">
          <span className="reveal-mask">
            <span className="reveal-inner" style={{ animationDelay: '0.6s' }}>{desc}</span>
          </span>
        </p>

        <div className="hero-glow-actions">{actions}</div>
      </div>
    </section>
  )
}
