'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useScramble } from './Scramble'
import { useExperienceActive, useLamaReady } from './ready'

const CALENDLY = 'https://calendly.com/mdmmarketing-info/10-minute-content-subscription-discovery-call-m-clone'

const LINKS = [
  { href: '/work', label: 'Work' },
  { href: '/#services', label: 'What we do' },
  { href: '/about', label: 'About us' },
  { href: '/journal', label: 'Journal' },
  { href: '/events', label: 'Events' },
  { href: '/#contact', label: 'Contact' },
]

export default function LamaNav({ gate = true }: {
  /** wait for the homepage preloader before fading in — disable on pages without it */
  gate?: boolean
} = {}) {
  const [title, setTitle] = useState('MD MEDIA MARKETING')
  const [open, setOpen] = useState(false)
  const display = useScramble(title, { duration: 500 })
  const inExperience = useExperienceActive()
  const lamaReady = useLamaReady()
  const ready = gate ? lamaReady : true

  useEffect(() => {
    const sections = document.querySelectorAll<HTMLElement>('[data-lama-title]')
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setTitle((e.target as HTMLElement).dataset.lamaTitle!)
        }
      },
      { rootMargin: '-40% 0px -55% 0px' },
    )
    sections.forEach((s) => io.observe(s))
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  return (
    <>
      <header
        className={`fixed top-4 left-1/2 z-[110] -translate-x-1/2 w-[min(480px,calc(100vw-2rem))] transition-opacity duration-500 ${ready && !inExperience ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      >
        <div className="flex items-center justify-between rounded-full border border-cream/15 bg-black/55 backdrop-blur-md px-5 py-3 shadow-lg">
          <Link href="/" aria-label="MD Media home" className="no-underline">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/MDLogo-trim.png" alt="MD Media" className="h-5 w-auto" />
          </Link>
          <span className="font-lamam text-[11px] uppercase tracking-widest [word-spacing:0.45em] text-cream">{display}</span>
          <button
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="flex flex-col gap-1 p-1 appearance-none border-0 bg-transparent cursor-pointer"
          >
            <span className={`block h-0.5 w-5 bg-cream transition-transform ${open ? 'translate-y-1.5 rotate-45' : ''}`} />
            <span className={`block h-0.5 w-5 bg-cream transition-opacity ${open ? 'opacity-0' : ''}`} />
            <span className={`block h-0.5 w-5 bg-cream transition-transform ${open ? '-translate-y-1.5 -rotate-45' : ''}`} />
          </button>
        </div>
      </header>

      {open && (
        /* design-pack menu: fixed blurred overlay + compact pop-in panel */
        <nav
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-[105] flex items-start justify-center overflow-y-auto bg-[rgba(11,11,11,0.72)] p-3.5 pb-7 backdrop-blur-[14px] [animation:lama-menu-fade_0.35s_ease_both]"
        >
          <div
            onClick={e => e.stopPropagation()}
            className="mt-16 w-[min(92vw,clamp(340px,31vw,560px))] overflow-hidden rounded-[14px] border border-cream/[0.14] bg-ink shadow-[0_40px_110px_rgba(0,0,0,0.7)] [animation:lama-menu-panel_0.5s_cubic-bezier(0.16,1,0.3,1)_both]"
          >
            <div className="flex items-center justify-between gap-4 border-b border-cream/[0.14] px-4 py-3">
              <span className="font-lamah font-bold text-[13px] tracking-[-0.01em] text-cream">MD&nbsp;MEDIA</span>
              <span className="whitespace-nowrap font-lamam text-[9px] uppercase tracking-[0.1em] text-cream/45">
                get seen · get known · get booked
              </span>
              <button
                aria-label="Close menu"
                onClick={() => setOpen(false)}
                className="flex h-6 w-6 cursor-pointer appearance-none items-center justify-center border-0 bg-transparent p-0"
              >
                <span className="block h-[1.5px] w-[18px] bg-cream" />
              </button>
            </div>
            {LINKS.map((l, i) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="group flex items-center justify-between gap-4 border-b border-cream/[0.12] px-4 py-3 text-cream no-underline transition-colors [animation:lama-menu-rowin_0.5s_cubic-bezier(0.16,1,0.3,1)_both] hover:bg-gradient-to-r hover:from-cream/[0.13] hover:via-cream/[0.04] hover:to-transparent"
                style={{ animationDelay: `${0.06 * (i + 1)}s` }}
              >
                <span className="flex items-center gap-3">
                  <span className="font-lamam text-[10px] text-cream opacity-30 transition-opacity duration-300 group-hover:opacity-100">
                    {`0${i + 1}`}
                  </span>
                  <span className="font-lamah font-medium tracking-[-0.02em] text-[clamp(0.95rem,1.4vw,1.1rem)]">
                    {l.label}
                  </span>
                </span>
                <span className="font-lamam text-[13px] opacity-0 transition-[opacity,transform] duration-300 group-hover:translate-x-[3px] group-hover:-translate-y-[3px] group-hover:opacity-100">
                  ↗︎
                </span>
              </Link>
            ))}
            <div
              className="flex flex-col gap-2 p-3.5 [animation:lama-menu-rowin_0.5s_cubic-bezier(0.16,1,0.3,1)_both]"
              style={{ animationDelay: '0.42s' }}
            >
              <Link
                href="/events"
                onClick={() => setOpen(false)}
                className="rounded-lg border border-cream/[0.28] p-3.5 text-center font-lamam text-[10px] uppercase tracking-[0.06em] text-cream no-underline transition-colors hover:bg-cream/[0.08]"
              >
                request an invite
              </Link>
              <div className="grid grid-cols-2 gap-2">
                <a
                  href={CALENDLY}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="rounded-lg bg-cream p-3.5 text-center font-lamam font-bold text-[10px] uppercase tracking-[0.06em] text-ink no-underline transition-colors hover:bg-cream/[0.86]"
                >
                  book a call
                </a>
                <Link
                  href="/work"
                  onClick={() => setOpen(false)}
                  className="rounded-lg bg-cream p-3.5 text-center font-lamam font-bold text-[10px] uppercase tracking-[0.06em] text-ink no-underline transition-colors hover:bg-cream/[0.86]"
                >
                  see our work
                </Link>
              </div>
            </div>
          </div>
        </nav>
      )}
    </>
  )
}
