'use client'

import { useMemo, useState } from 'react'
import { Scramble } from '../components/lama/Scramble'
import Reveal from '../components/lama/Reveal'
import AsciiHands from '../components/AsciiHands'
import SiteMedia from '../components/SiteMedia'
import type { SiteProject } from '../lib/websiteData'
import { collectServices, hasService } from '../lib/services-core'

// The static-pack Work page grid: kicker, big two-line headline, intro,
// mono FILTER chip row with a live project count, then an auto-fit card
// grid — rounded 4:3 media showing its first frame, name + ↗
// that nudges on hover, "Service · Industry" mono line, description.
//
// The chips ARE the services set in the CMS. They used to be a fixed list of
// six matched by regex against the services text, which meant the filters
// silently disagreed with the data: a service nobody had a pattern for was
// unfilterable, and renaming one could empty a chip without anything failing.
// Adding a service in the dashboard now adds a chip here, and nothing else has
// to be edited to keep them in step.
export default function WorkGrid({ projects }: { projects: SiteProject[] }) {
  const [filter, setFilter] = useState<string>('all')

  const services = useMemo(() => collectServices(projects), [projects])

  // a filter for a service that has since been renamed or removed would show
  // an empty grid with no way back, so fall back to all
  const active = filter !== 'all' && services.includes(filter) ? filter : 'all'
  const visible = projects
    .filter(p => active === 'all' || hasService(p.services, active))
    .map(p => ({ p }))

  return (
    <main className="relative z-10">
      <section className="relative overflow-hidden px-6 pt-40 sm:px-10 sm:pt-48">
        {/* The ASCII hand reaches in from the right edge, behind the copy.
            Hidden below lg — at narrow widths it would sit on the headline
            rather than beside it. The headline is capped at 16ch, so on wide
            screens the right half is empty and the hand fills it. */}
        <div className="pointer-events-none absolute inset-0 hidden lg:block" aria-hidden="true">
          <AsciiHands layout="diagonal-right" charRgb="249, 244, 235" hoverCharColor="#0B0B0B" />
        </div>

        <div className="relative z-10">
          <Scramble
            text="WORK / SELECTED PROJECTS"
            gate={false}
            className="font-lamam text-[11px] uppercase tracking-[0.14em] text-cream/50"
          />
          <h1 className="mt-6 max-w-[16ch] font-lamah font-normal text-cream leading-[1.02] tracking-[-0.035em] text-[clamp(2.4rem,6vw,5.5rem)]">
            The businesses we made impossible to ignore.
          </h1>
          <p className="mt-8 max-w-[46ch] font-lamah text-cream/60 text-[clamp(1rem,1.3vw,1.15rem)] leading-normal">
            Hospitality, property, fashion, fragrance, engineering and health. A look at
            the content, campaigns and brands we&rsquo;ve built.
          </p>
        {/* Capped to the left of the hands. The chips are CMS-driven, so the
            row grows as services are added — unconstrained it ran under the
            ASCII hands on wide screens. Wrapping earlier costs a line; running
            under the artwork costs legibility. */}
        <div className="mt-12 flex flex-wrap items-center gap-2.5 lg:max-w-[58%]">
          <span className="mr-2 font-lamam text-[11px] uppercase tracking-[0.14em] text-cream/40">
            Filter
          </span>
          {['all', ...services].map(key => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`cursor-pointer appearance-none rounded-full border-0 px-[15px] py-[7px] font-lamam text-xs transition-colors duration-300 ${
                active === key
                  ? 'bg-cream text-ink'
                  : 'bg-transparent text-cream/70 shadow-[inset_0_0_0_1px_rgba(249,244,235,0.25)] hover:text-cream'
              }`}
            >
              {key === 'all' ? 'All' : key}
            </button>
          ))}
          <span className="ml-auto font-lamam text-[11px] text-cream/35">
            {visible.length} project{visible.length === 1 ? '' : 's'}
          </span>
          </div>
        </div>
      </section>

      <section className="px-6 pb-[clamp(70px,10vh,120px)] pt-[clamp(40px,6vh,72px)] sm:px-10">
        <div className="grid gap-[clamp(28px,4vw,56px)] [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
          {visible.map(({ p }) => (
            <a key={p.slug} href={`/work/${p.slug}`} className="group flex h-full flex-col text-cream no-underline">
              <div className="relative overflow-hidden rounded-[14px]">
                {/* Fixed frame so every card in a row is the same height, with
                    object-contain so a 9:16 reel is fitted inside it instead of
                    cropped to a band through the middle. */}
                <SiteMedia
                  src={p.cardMedia}
                  alt={p.name}
                  className="block aspect-[4/3] w-full bg-ink object-contain transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.04]"
                />
              </div>
              <div className="mt-5 flex items-start justify-between gap-4">
                <div>
                  <h3 className="line-clamp-1 font-lamah font-medium tracking-[-0.02em] text-[1.35rem] leading-tight">
                    {p.name}
                  </h3>
                  <p className="mt-1.5 font-lamam text-xs text-cream/50">
                    {p.services[0] ?? 'Content'} · {p.industry}
                  </p>
                </div>
                <span className="text-[1.3rem] transition-transform duration-[400ms] group-hover:translate-x-[3px] group-hover:-translate-y-[3px]">
                  ↗
                </span>
              </div>
              {/* clamped so a long description cannot make one card taller
                  than the rest of its row */}
              <p className="mt-3.5 line-clamp-2 font-lamah text-cream/55 text-[0.98rem] leading-normal">
                {p.desc}
              </p>
            </a>
          ))}
        </div>

        {visible.length === 0 && (
          <p className="py-20 text-center font-lamah text-cream/50">
            Nothing under that filter yet.
          </p>
        )}
      </section>

      {/* Closing band from the design pack: the grid is the argument, this is
          the ask. Sits above the footer so the last thing read is an action,
          not a sitemap. */}
      <section className="border-t border-cream/[0.12] px-6 py-[clamp(100px,16vh,200px)] text-center sm:px-10">
        <div className="mx-auto max-w-[1100px]">
          <h2 className="font-lamah font-medium text-cream leading-[1.0] tracking-[-0.04em] text-[clamp(2rem,5.5vw,4.6rem)]">
            <span className="block overflow-hidden">
              <Reveal gate={false}><span className="block pb-[0.1em]">Your business could be</span></Reveal>
            </span>
            <span className="block overflow-hidden">
              <Reveal gate={false} delay={0.08}><span className="block pb-[0.1em]">the next one up here.</span></Reveal>
            </span>
          </h2>

          <a
            href="mailto:hello@mdmmarketing.com.au"
            className="mt-9 inline-flex items-center gap-2.5 rounded-full bg-cream px-9 py-[17px] font-lamam text-sm font-bold tracking-[0.04em] text-ink no-underline transition-opacity duration-300 hover:opacity-85"
          >
            start now <span className="text-base">&rarr;</span>
          </a>
        </div>
      </section>
    </main>
  )
}
