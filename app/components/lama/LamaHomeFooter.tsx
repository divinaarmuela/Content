'use client'

import Link from 'next/link'
import Rule from './Rule'
import { Scramble } from './Scramble'
import { Clock } from './LamaFooterBar'

// The static-pack footer for the homepage: the hero's mono metadata bar
// reprised at the top (its rule grows again on arrival — a fresh
// once-Rule), then the four-column grid (brand blurb / explore / contact
// / social) and the hairline bottom row.
const EXPLORE = [
  { label: 'Home', href: '/' },
  { label: 'Work', href: '/work' },
  { label: 'About', href: '/about' },
  { label: 'Journal', href: '/journal' },
  { label: 'Events', href: '/events' },
  { label: 'Services', href: '/#services' },
]

export default function LamaHomeFooter() {
  return (
    <footer className="border-t border-cream/10 px-6 sm:px-10 pt-[clamp(48px,7vh,80px)] pb-9">
      {/* the hero bar, re-grown at the bottom */}
      <div className="mb-[clamp(48px,7vh,72px)]">
        <Rule once />
        <div className="flex w-full items-center gap-6 pt-3 font-lamam text-[11px] uppercase tracking-wider text-cream">
          <span className="lg:w-2/12"><Scramble text="EST. 2024" /></span>
          <span className="hidden sm:block lg:w-2/12"><Scramble text="MELBOURNE BASED" delay={120} /></span>
          <span className="hidden lg:block lg:w-4/12"><Clock /></span>
          <span className="ml-auto flex items-center gap-10">
            <Scramble text="FOLLOW US" delay={240} className="text-cream-dim" />
            <a href="https://www.instagram.com/mdmedia._" target="_blank" rel="noreferrer noopener" className="text-cream visited:text-cream no-underline hover:text-accent transition-colors">
              <Scramble text="INSTAGRAM +" delay={320} />
            </a>
            <a href="https://www.linkedin.com/company/mdmedia-marketing/" target="_blank" rel="noreferrer noopener" className="text-cream visited:text-cream no-underline hover:text-accent transition-colors">
              <Scramble text="LINKEDIN +" delay={400} />
            </a>
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-10 pb-14 sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr_1fr]">
        <div>
          <span className="font-lamah font-bold text-cream text-[17px] tracking-[-0.01em]">MD&nbsp;MEDIA</span>
          <p className="mt-4 max-w-[280px] font-lamah text-cream/50 text-[0.98rem] leading-normal">
            Content-led marketing for founders and local businesses ready to be seen,
            known, and booked.
          </p>
        </div>
        <div>
          <span className="font-lamam text-[11px] uppercase tracking-[0.1em] text-cream/40">explore</span>
          <div className="mt-4 flex flex-col gap-3">
            {EXPLORE.map(l => (
              <Link key={l.label} href={l.href} className="font-lamah text-cream/70 text-[0.96rem] no-underline transition-colors hover:text-cream">
                {l.label}
              </Link>
            ))}
          </div>
        </div>
        <div>
          <span className="font-lamam text-[11px] uppercase tracking-[0.1em] text-cream/40">contact</span>
          <div className="mt-4 flex flex-col gap-3">
            <a href="mailto:hello@mdmmarketing.com.au" className="font-lamah text-cream/70 text-[0.96rem] no-underline transition-colors hover:text-cream">
              hello@mdmmarketing.com.au
            </a>
            <span className="font-lamah text-cream/50 text-[0.96rem]">Australia · remote &amp; on location</span>
          </div>
        </div>
        <div>
          <span className="font-lamam text-[11px] uppercase tracking-[0.1em] text-cream/40">social</span>
          <div className="mt-4 flex flex-col gap-3">
            <a href="https://www.instagram.com/mdmedia._" target="_blank" rel="noreferrer noopener" className="font-lamah text-cream/70 text-[0.96rem] no-underline transition-colors hover:text-cream">
              Instagram
            </a>
            <a href="https://www.linkedin.com/company/mdmedia-marketing/" target="_blank" rel="noreferrer noopener" className="font-lamah text-cream/70 text-[0.96rem] no-underline transition-colors hover:text-cream">
              LinkedIn
            </a>
            <a href="https://www.tiktok.com/@mdmedia._" target="_blank" rel="noreferrer noopener" className="font-lamah text-cream/70 text-[0.96rem] no-underline transition-colors hover:text-cream">
              TikTok
            </a>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap justify-between gap-4 border-t border-cream/10 pt-6">
        <span className="font-lamam text-[11px] text-cream/40">AUSTRALIA · EST. 2024</span>
        <span className="font-lamam text-[11px] text-cream/40">© MD MEDIA, all rights reserved</span>
      </div>
    </footer>
  )
}
