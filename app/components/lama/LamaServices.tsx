'use client'

import { useRef, useState } from 'react'
import Reveal from './Reveal'
import { Scramble } from './Scramble'

const COLUMNS = [
  { label: '[ CONTENT ]', items: ['Content Production', 'Social Media Management', 'Brand Photography', 'Video Direction'] },
  { label: '[ ADVERTISING ]', items: ['Paid Ads (Meta & Google)', 'Performance Strategy', 'Lead Generation'] },
  { label: '[ BRAND & STRATEGY ]', items: ['Brand Strategy', 'Visual Identity', 'Messaging', 'Strategy & Consulting'] },
  { label: '[ DIGITAL ]', items: ['Websites', 'Front-End Development', 'Back-End Development', 'E-Commerce'] },
]

export default function LamaServices() {
  const rowRef = useRef<HTMLDivElement>(null)
  // mobile browsers hide native scrollbars, so the swipe progress renders as
  // an explicit bar under the row
  const [progress, setProgress] = useState(0)

  const onScroll = () => {
    const el = rowRef.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    setProgress(max > 0 ? el.scrollLeft / max : 0)
  }

  return (
    <section data-lama-title="WHAT WE DO" className="px-6 sm:px-10 py-32 sm:py-44">
      <Reveal>
        <h2 className="font-lamah font-bold uppercase text-cream leading-[0.8] tracking-[-0.02em] text-[clamp(3rem,8vw,7.5rem)]">
          What we do.
        </h2>
      </Reveal>
      <Reveal delay={150}>
        <p className="mt-10 font-lamah text-cream-dim text-lg max-w-xl">
          Start with content. Scale into the rest.
        </p>
      </Reveal>
      <Reveal delay={250}>
        <p className="mt-6 font-lamah text-cream text-xl leading-snug max-w-2xl">
          We make you visible first, then build the strategy and systems behind it.
          Content, paid, brand, and strategy under one roof, no juggling vendors.
          Your content sounds like you and looks like you, not a template.
          Start small, scale when it&rsquo;s working.
        </p>
      </Reveal>
      <div
        ref={rowRef}
        onScroll={onScroll}
        className="mt-20 -mx-6 flex gap-5 overflow-x-auto px-6 pb-4 snap-x snap-mandatory scroll-px-6 [-webkit-overflow-scrolling:touch] [overscroll-behavior-x:contain] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:-mx-10 sm:px-10 sm:scroll-px-10 md:mx-0 md:grid md:grid-cols-2 lg:grid-cols-4 md:gap-12 md:overflow-visible md:px-0 md:pb-0"
      >
        {COLUMNS.map((col, i) => (
          <Reveal key={col.label} delay={i * 120} className="shrink-0 w-[68vw] sm:w-[44vw] snap-start snap-always md:w-auto md:shrink">
            <Scramble text={col.label} className="font-lamam text-[11px] uppercase tracking-widest text-cream-dim" />
            <ul className="mt-6 space-y-3">
              {col.items.map((item) => (
                <li key={item} className="font-lamah text-cream text-lg">{item}</li>
              ))}
            </ul>
          </Reveal>
        ))}
      </div>
      {/* swipe progress bar (mobile only) */}
      <div aria-hidden="true" className="mt-2 h-px bg-cream/15 md:hidden">
        <div
          className="h-full bg-cream/70 transition-[width] duration-150"
          style={{ width: `${Math.round((0.25 + progress * 0.75) * 100)}%` }}
        />
      </div>
    </section>
  )
}
