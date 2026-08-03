'use client'

import Link from 'next/link'
import { useState } from 'react'
import Reveal from './Reveal'
import { Scramble } from './Scramble'
import SiteMedia from '../SiteMedia'
import type { SiteProject } from '../../lib/websiteData'

// Lama Lama case-row accordion. The header keeps the collapsed 12-col
// anatomy (name 2/12, pills 3/12, ( + ) 1/12, media right) but is a button:
// clicking toggles the panel below — navigation only happens through the
// VIEW CASE / VISIT WEBSITE links inside it. One row open at a time.
export default function LamaWorkRows({ projects }: { projects: SiteProject[] }) {
  const [openSlug, setOpenSlug] = useState<string | null>(null)
  // once a panel has been opened its content stays mounted, so the close
  // animation has something to collapse and media doesn't all load upfront
  const [opened, setOpened] = useState<Set<string>>(new Set())

  const toggle = (slug: string) => {
    setOpenSlug(cur => (cur === slug ? null : slug))
    setOpened(cur => (cur.has(slug) ? cur : new Set(cur).add(slug)))
  }

  return (
    <section data-lama-title="SELECTED WORK" className="!pt-0 !pb-6">
      {projects.map((c, i) => {
        const isOpen = openSlug === c.slug
        return (
          <Reveal key={c.slug} delay={Math.min(i * 60, 240)}>
            <div className="relative">
              <div aria-hidden="true" className="absolute left-0 right-0 top-0 h-px bg-cream opacity-20" />
              <button
                type="button"
                onClick={() => toggle(c.slug)}
                aria-expanded={isOpen}
                // preflight is off site-wide, so strip the UA button chrome
                // (white background, border) explicitly
                className="group relative flex w-full cursor-pointer appearance-none flex-col border-0 bg-transparent text-left lg:flex-row lg:items-center gap-4 lg:gap-6 px-6 sm:px-10 py-5 lg:py-6 hover:bg-cream/5 transition-colors"
              >
                {/* mobile: stacked card — full-width media on top, then the name
                    row with the toggle pushed right, tags wrapping below */}
                <SiteMedia
                  src={c.cardMedia}
                  alt=""
                  className="lg:hidden w-full aspect-video object-cover bg-ink"
                />
                <span className="flex items-baseline justify-between lg:block lg:w-2/12">
                  <span className="font-lamah text-cream text-lg sm:text-xl">{c.name}</span>
                  <span className="font-lamam text-xs text-cream-dim lg:hidden">{isOpen ? '( - )' : '( + )'}</span>
                </span>
                <span className="flex flex-wrap gap-1 lg:w-3/12">
                  {c.services.slice(0, 3).map((s, j) => (
                    <span key={s} className="bg-cream/10 px-2 py-1 font-lamam text-[10px] uppercase tracking-wider text-cream whitespace-nowrap">
                      <Scramble text={s} delay={j * 120} />
                    </span>
                  ))}
                </span>
                <span className="hidden lg:block font-lamam text-xs text-cream-dim lg:w-1/12">{isOpen ? '( - )' : '( + )'}</span>
                <span className="hidden lg:flex justify-end lg:flex-1">
                  <SiteMedia
                    src={c.cardMedia}
                    alt={c.name}
                    className="h-[90px] sm:h-[120px] w-auto object-cover bg-ink opacity-75 group-hover:opacity-100 group-hover:scale-[1.02] transition-all duration-300"
                  />
                </span>
              </button>

              <div
                className={`grid transition-[grid-template-rows] duration-500 ease-in-out ${isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
              >
                <div className="min-h-0 overflow-hidden">
                  {opened.has(c.slug) && (
                    <div className="flex flex-col gap-6 px-6 pb-8 sm:px-10 lg:gap-8">
                      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                        <div className="flex flex-wrap gap-3">
                          <Link
                            href={`/work/${c.slug}`}
                            className="border border-cream/25 px-5 py-3 font-lamam text-[11px] uppercase tracking-wider text-cream no-underline transition-colors hover:bg-cream/10"
                          >
                            View case ↗
                          </Link>
                          {c.websiteUrl && (
                            <a
                              href={c.websiteUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="border border-cream/25 px-5 py-3 font-lamam text-[11px] uppercase tracking-wider text-cream no-underline transition-colors hover:bg-cream/10"
                            >
                              Visit website ↗
                            </a>
                          )}
                        </div>
                        {c.desc && (
                          <p className="max-w-prose font-lamam text-sm leading-relaxed text-cream-dim lg:w-5/12">
                            {c.desc}
                          </p>
                        )}
                      </div>
                      {c.galleryUrls.length > 0 && (
                        <div className="-mx-6 flex gap-2 overflow-x-auto px-6 sm:-mx-10 sm:px-10">
                          {c.galleryUrls.map(url => (
                            <SiteMedia
                              key={url}
                              src={url}
                              alt={c.name}
                              className="h-[220px] w-auto flex-none object-cover bg-ink sm:h-[300px] lg:h-[400px]"
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Reveal>
        )
      })}
    </section>
  )
}
