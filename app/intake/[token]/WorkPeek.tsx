'use client'

import { useEffect, useRef } from 'react'
import { workPeek, type WorkTile } from '../../lib/discovery-work'

/**
 * THE SNEAK PEEK ON THE DISCOVERY FORM'S THANK-YOU SCREEN (Abby, via the owner, 20 Nov 2026; discovery-work.ts says
 * what is shown). The owner, the same day: "list it nicely, maybe some videos or image which links to the work page,
 * please design them nicely". One large tile and four small ones, the brand's own loop playing where it has one, each
 * opening its page on the site; and one button on to all of it. Shown only after the form is sent, so it never
 * competes with the questions. No <section>: the marketing site gives every section 100px of padding and a rule.
 */

/** a brand's loop: silent, and playing only while it is on screen, so a phone is not running five videos at once */
function Loop({ src, poster }: { src: string; poster: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const v = ref.current
    // somebody who asked their device for less motion keeps the still
    if (!v || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) v.play().catch(() => {}); else v.pause() }, { threshold: 0.25 })
    io.observe(v)
    return () => io.disconnect()
  }, [])
  return <video ref={ref} muted loop playsInline preload="none" poster={poster} src={src} aria-hidden className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.04]" />
}

function Tile({ t, big }: { t: WorkTile; big?: boolean }) {
  return (
    <a href={t.href} className="group relative block h-full w-full overflow-hidden rounded-[16px] bg-cream/[0.06] text-cream no-underline">
      {t.video
        ? <Loop src={t.video} poster={t.image} />
        // eslint-disable-next-line @next/next/no-img-element -- our own work, from the site's own files
        : <img src={t.image} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.04]" />}
      {/* the name sits on the picture, on a shade dark enough to read it over any frame */}
      <span aria-hidden className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/85 via-black/35 to-transparent" />
      <span aria-hidden className={`absolute right-3 top-3 flex items-center justify-center rounded-full bg-black/45 text-cream backdrop-blur transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 ${big ? 'h-10 w-10 text-[16px]' : 'h-8 w-8 text-[13px]'}`}>↗</span>
      <span className={`absolute inset-x-0 bottom-0 block ${big ? 'p-5 sm:p-6' : 'p-3.5 sm:p-4'}`}>
        <span className="block font-lamam text-[10px] uppercase tracking-widest text-cream/70">{t.sector}</span>
        <span className={`mt-1.5 block font-lamah font-medium leading-tight tracking-[-0.01em] ${big ? 'text-[22px] sm:text-[28px]' : 'text-[15px] sm:text-[16px]'}`}>{t.name}</span>
      </span>
    </a>
  )
}

export default function WorkPeek({ industry }: { industry: string | null }) {
  const { matched, mixed, tiles } = workPeek(industry)
  if (tiles.length === 0) return null
  const [first, ...rest] = tiles
  return (
    <div className="mt-20 w-full max-w-5xl">
      <div className="mx-auto mb-10 h-px w-16 bg-cream/25" aria-hidden />
      <h2 className="m-0 text-center font-lamah text-[26px] font-medium leading-[1.15] tracking-[-0.02em] text-cream sm:text-[34px]">
        {matched ? (mixed ? `Our work in ${matched}, and beyond` : `Our work in ${matched}`) : 'A look at our work'}
      </h2>
      <p className="mx-auto mb-0 mt-3 max-w-[40ch] text-center font-lamah text-[15px] leading-relaxed text-cream-dim">
        While you wait to hear from us, here are some of the brands we work with.
      </p>
      {/* one large, four small: on a phone the large one runs full width with the rest two to a row */}
      <ul className="m-0 mt-10 grid list-none grid-cols-2 gap-3 p-0 sm:gap-4 lg:auto-rows-[260px] lg:grid-cols-4">
        <li className="col-span-2 aspect-[4/5] sm:aspect-[16/11] lg:row-span-2 lg:aspect-auto"><Tile t={first} big /></li>
        {rest.map(t => <li key={t.name} className="aspect-[4/5] lg:aspect-auto"><Tile t={t} /></li>)}
      </ul>
      <p className="mb-0 mt-10 text-center">
        <a href="/work" className="inline-flex min-h-12 items-center gap-2 rounded-full bg-cream px-7 font-lamam text-[11px] uppercase tracking-widest text-ink no-underline transition-opacity hover:opacity-85">
          See all our work <span aria-hidden>→</span>
        </a>
      </p>
    </div>
  )
}
