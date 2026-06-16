'use client'

import { useEffect, useRef, useState } from 'react'

const QUESTIONS = [
  { label: 'Reach',     q: 'What platforms are you active on?' },
  { label: 'Pipeline',  q: 'How many leads come from your content?' },
  { label: 'Strategy',  q: 'Do you have a content strategy or just a posting schedule?' },
  { label: 'History',   q: "What have you tried that didn't work?" },
  { label: 'Outcome',   q: 'What does success look like in 90 days?' },
]

const DOTS = 'repeating-linear-gradient(to bottom, COLOR 0 2px, transparent 2px 10px)'
const DIM_LINE    = DOTS.replace('COLOR', 'rgba(255,255,255,0.16)')
const BRIGHT_LINE = DOTS.replace('COLOR', 'rgba(255,255,255,1)')
const BAND = 220   // px height of the lit zone around the marker

export default function DiagnosticReveal() {
  const [visible, setVisible] = useState(false)

  const timelineRef = useRef<HTMLDivElement>(null)
  const glowRef     = useRef<HTMLDivElement>(null)
  const markerRef   = useRef<HTMLDivElement>(null)

  // header appear / reappear, driven by SilkTransition events
  useEffect(() => {
    const show = () => setVisible(true)
    const hide = () => setVisible(false)
    window.addEventListener('diag-show', show)
    window.addEventListener('diag-hide', hide)
    return () => {
      window.removeEventListener('diag-show', show)
      window.removeEventListener('diag-hide', hide)
    }
  }, [])

  // light up the dots that are passing the viewport centre; the marker rides
  // down the line as you scroll (the rest of the line stays dim)
  useEffect(() => {
    const tl = timelineRef.current
    const glow = glowRef.current
    const marker = markerRef.current
    if (!tl || !glow || !marker) return

    let raf = 0
    const update = () => {
      const rect = tl.getBoundingClientRect()
      const yOnLine = window.innerHeight / 2 - rect.top   // viewport centre, in line coords
      glow.style.webkitMaskPosition = `center ${yOnLine - BAND / 2}px`
      glow.style.maskPosition = `center ${yOnLine - BAND / 2}px`
      marker.style.transform = `translate(-50%, ${yOnLine}px)`
      raf = requestAnimationFrame(update)
    }
    raf = requestAnimationFrame(update)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <section id="diagnostic-reveal" className="relative bg-black text-white">
      {/* intro header — scales in from the middle on reveal, then scrolls away */}
      <div className="flex min-h-screen flex-col items-center justify-center px-[clamp(20px,6vw,80px)] text-center">
        <h2
          className="max-w-[18ch] font-sans font-medium leading-[0.98] tracking-[-0.035em] text-[clamp(40px,7vw,118px)] will-change-transform"
          style={{
            transformOrigin: 'center',
            transform: visible ? 'scale(1)' : 'scale(0.55)',
            opacity: visible ? 1 : 0,
            transition: 'transform 0.65s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.5s ease',
          }}
        >
          Find out what&apos;s costing you growth
        </h2>
        <p
          className="mt-[clamp(28px,5vh,56px)] flex items-center justify-center gap-3 font-sans text-[clamp(14px,1.4vw,20px)] font-medium text-white/80"
          style={{
            opacity: visible ? 1 : 0,
            transform: visible ? 'translateY(0)' : 'translateY(12px)',
            transition: 'transform 0.6s cubic-bezier(0.22, 1, 0.36, 1) 0.12s, opacity 0.5s ease 0.12s',
          }}
        >
          <span className="inline-block h-[0.7em] w-[0.7em] flex-shrink-0 bg-[#298dff]" aria-hidden="true" />
          5 questions. 2 minutes. You&apos;ll see exactly where your brand is leaking attention and revenue.
        </p>
      </div>

      {/* ── timeline: full dim dotted line; dots light up as they pass the marker ── */}
      <div
        ref={timelineRef}
        className="relative mx-auto w-full max-w-[1180px] px-[clamp(20px,6vw,80px)] pb-[28vh] pt-[6vh]"
      >
        {/* dim full-height dotted line */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 left-1/2 top-0 w-[2px] -translate-x-1/2"
          style={{ backgroundImage: DIM_LINE }}
        />
        {/* bright copy, revealed only in a band that tracks the viewport centre */}
        <div
          ref={glowRef}
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 left-1/2 top-0 w-[2px] -translate-x-1/2"
          style={{
            backgroundImage: BRIGHT_LINE,
            maskImage: 'linear-gradient(to bottom, transparent, #000 50%, transparent)',
            WebkitMaskImage: 'linear-gradient(to bottom, transparent, #000 50%, transparent)',
            maskSize: `100% ${BAND}px`,
            WebkitMaskSize: `100% ${BAND}px`,
            maskRepeat: 'no-repeat',
            WebkitMaskRepeat: 'no-repeat',
          }}
        />
        {/* square marker that rides down the line */}
        <div
          ref={markerRef}
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-0 z-20 h-3.5 w-3.5 bg-white shadow-[0_0_0_7px_#000]"
        />

        {/* cards */}
        <div className="relative z-10 flex flex-col gap-[24vh]">
          {QUESTIONS.map(({ label, q }, i) => {
            const left = i % 2 === 0
            return (
              <div key={i} className={`flex ${left ? 'justify-start' : 'justify-end'}`}>
                <article className="relative w-[clamp(280px,47%,560px)] border border-white/15 bg-white/[0.025]">
                  <header className="flex items-center gap-4 border-b border-white/15 px-[clamp(16px,1.6vw,24px)] py-[clamp(14px,1.6vh,20px)]">
                    <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center border border-white/30 font-mono text-sm text-white/85">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <h3 className="font-sans text-[clamp(16px,1.6vw,24px)] font-medium leading-[1.15] tracking-[-0.01em]">
                      {q}
                    </h3>
                  </header>
                  <div className="flex min-h-[120px] items-end px-[clamp(16px,1.6vw,24px)] py-[clamp(16px,2vh,28px)]">
                    <span className="font-mono text-xs uppercase tracking-[0.18em] text-[#298dff]">
                      {label}
                    </span>
                  </div>
                </article>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
