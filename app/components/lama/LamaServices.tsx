'use client'

import { useRef, useState } from 'react'
import Reveal from './Reveal'
import { Scramble } from './Scramble'

const COLUMNS = [
  { label: '[ 01 STRATEGY & CONSULTING ]', items: ['Positioning', 'Offer & pricing review', 'Marketing roadmap', 'Ongoing advisory'] },
  { label: '[ 02 BRANDING SUITE ]', items: ['Logo & identity', 'Messaging & voice', 'Colour & type system', 'Templates & assets'] },
  { label: '[ 03 CUSTOM WEBSITES ]', items: ['Design & build', 'Copy & structure', 'Mobile & speed', 'Hosting & care'] },
  { label: '[ 04 CONTENT & VISIBILITY ]', items: ['Content strategy', 'Photo, video & campaign shoots', 'Social & captions', 'Ongoing posting'] },
  { label: '[ 05 PAID ADVERTISING ]', items: ['Campaign strategy', 'Ad creative & copy', 'Setup & management', 'Clear reporting'] },
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
    <section data-lama-title="SERVICES, NOT PACKAGES" className="px-6 sm:px-10 py-32 sm:py-44">
      <Reveal>
        <h2 className="font-lamah font-bold uppercase text-cream leading-[0.8] tracking-[-0.02em] text-[clamp(3rem,8vw,7.5rem)]">
          We meet you where you&rsquo;re at.
        </h2>
      </Reveal>
      <Reveal delay={150}>
        <p className="mt-10 font-lamah text-cream-dim text-lg max-w-xl">
          Services, not packages.
        </p>
      </Reveal>
      <Reveal delay={250}>
        <p className="mt-6 font-lamah text-cream text-xl leading-snug max-w-2xl">
          There&rsquo;s no fixed starting point. Some businesses need a clear strategy first;
          others need a brand, a campaign shoot, content, or paid, or all of it.
          We start wherever you are and build out from there.
        </p>
      </Reveal>
      <div
        ref={rowRef}
        onScroll={onScroll}
        className="mt-20 -mx-6 flex gap-5 overflow-x-auto px-6 pb-4 snap-x snap-mandatory scroll-px-6 [-webkit-overflow-scrolling:touch] [overscroll-behavior-x:contain] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:-mx-10 sm:px-10 sm:scroll-px-10 md:mx-0 md:grid md:grid-cols-2 lg:grid-cols-5 md:gap-12 lg:gap-8 md:overflow-visible md:px-0 md:pb-0"
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
