'use client'

import { useMemo, useState } from 'react'
import { Scramble } from '../components/lama/Scramble'
import Reveal from '../components/lama/Reveal'
import AsciiHands from '../components/AsciiHands'
import SiteMedia from '../components/SiteMedia'
import { isVideoUrl } from '../lib/media-core'
import type { SiteProject } from '../lib/websiteData'

// The static-pack Work page grid: kicker, big two-line headline, intro,
// mono FILTER chip row with a live project count, then an auto-fit card
// grid — rounded 4:3 media (pulsing play badge on video cards), name + ↗
// that nudges on hover, "Service · Industry" mono line, description.
// Categories are derived from each project's CMS services list.
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'content', label: 'Content' },
  { key: 'paid', label: 'Paid' },
  { key: 'branding', label: 'Branding' },
  { key: 'websites', label: 'Websites' },
  { key: 'strategy', label: 'Strategy' },
] as const

type FilterKey = (typeof FILTERS)[number]['key']

const CAT_MATCHERS: Record<Exclude<FilterKey, 'all'>, RegExp> = {
  content: /content|photo|video|social|production|distribution|media/i,
  paid: /paid|ads\b|performance|lead gen|advertising/i,
  branding: /brand|identity|messaging|launch/i,
  websites: /web|site\b|e-?commerce|development/i,
  strategy: /strategy|consult|marketing/i,
}

function categoriesOf(p: SiteProject): FilterKey[] {
  const haystack = [...p.services, p.industry].join(' ')
  return (Object.keys(CAT_MATCHERS) as Exclude<FilterKey, 'all'>[]).filter(k =>
    CAT_MATCHERS[k].test(haystack),
  )
}

export default function WorkGrid({ projects }: { projects: SiteProject[] }) {
  const [filter, setFilter] = useState<FilterKey>('all')

  const withCats = useMemo(
    () => projects.map(p => ({ p, cats: categoriesOf(p) })),
    [projects],
  )
  const visible = withCats.filter(({ cats }) => filter === 'all' || cats.includes(filter))

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
        <div className="mt-12 flex flex-wrap items-center gap-2.5">
          <span className="mr-2 font-lamam text-[11px] uppercase tracking-[0.14em] text-cream/40">
            Filter
          </span>
          {FILTERS.map(f => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`cursor-pointer appearance-none rounded-full border-0 px-[15px] py-[7px] font-lamam text-xs transition-colors duration-300 ${
                filter === f.key
                  ? 'bg-cream text-ink'
                  : 'bg-transparent text-cream/70 shadow-[inset_0_0_0_1px_rgba(249,244,235,0.25)] hover:text-cream'
              }`}
            >
              {f.label}
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
            <a key={p.slug} href={`/work/${p.slug}`} className="group block text-cream no-underline">
              <div className="relative overflow-hidden rounded-[14px]">
                <SiteMedia
                  src={p.cardMedia}
                  alt={p.name}
                  className="block aspect-[4/3] w-full bg-ink object-cover transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.04]"
                />
                {isVideoUrl(p.cardMedia) && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div className="flex h-[60px] w-[60px] items-center justify-center rounded-full border border-cream/70 bg-ink/35 backdrop-blur-[3px] [animation:lama-play_2.6s_ease-in-out_infinite]">
                      <span className="ml-1 block h-0 w-0 border-y-[9px] border-l-[14px] border-y-transparent border-l-cream" />
                    </div>
                  </div>
                )}
                <span className="absolute bottom-2.5 left-3 font-lamam text-[10px] uppercase tracking-[0.12em] text-cream/75">
                  {isVideoUrl(p.cardMedia) ? 'video' : 'image'}
                </span>
              </div>
              <div className="mt-5 flex items-start justify-between gap-4">
                <div>
                  <h3 className="font-lamah font-medium tracking-[-0.02em] text-[1.35rem] leading-tight">
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
              <p className="mt-3.5 font-lamah text-cream/55 text-[0.98rem] leading-normal">{p.desc}</p>
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
