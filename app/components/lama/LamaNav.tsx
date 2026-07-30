'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useScramble } from './Scramble'

const CALENDLY = 'https://calendly.com/mdmmarketing-info/10-minute-content-subscription-discovery-call-m-clone'

const LINKS = [
  { href: '/work', label: 'Work' },
  { href: '/services', label: 'Services' },
  { href: '/about', label: 'About' },
  { href: '/contact', label: 'Contact' },
]

export default function LamaNav() {
  const [title, setTitle] = useState('MD MEDIA MARKETING')
  const [open, setOpen] = useState(false)
  const display = useScramble(title, { duration: 500 })

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
      <header className="fixed top-4 left-1/2 z-[110] -translate-x-1/2 w-[min(480px,calc(100vw-2rem))]">
        <div className="flex items-center justify-between bg-black px-4 py-3 shadow-lg">
          <Link href="/" aria-label="MD Media home" className="font-lamah font-bold text-cream text-sm leading-none">MD</Link>
          <span className="font-lamam text-[11px] uppercase tracking-widest text-cream">{display}</span>
          <button
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="flex flex-col gap-1 p-1"
          >
            <span className={`block h-0.5 w-5 bg-cream transition-transform ${open ? 'translate-y-1.5 rotate-45' : ''}`} />
            <span className={`block h-0.5 w-5 bg-cream transition-opacity ${open ? 'opacity-0' : ''}`} />
            <span className={`block h-0.5 w-5 bg-cream transition-transform ${open ? '-translate-y-1.5 -rotate-45' : ''}`} />
          </button>
        </div>
      </header>

      {open && (
        <nav className="fixed inset-0 z-[105] bg-black flex flex-col justify-center px-8 sm:px-20">
          {LINKS.map((l, i) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="group flex items-baseline gap-6 py-3 border-b border-cream/10"
            >
              <span className="font-lamam text-xs text-cream-dim">0{i + 1}</span>
              <span className="font-lamah font-bold uppercase text-cream text-[clamp(2rem,7vw,4.5rem)] leading-[0.9] tracking-tight group-hover:text-accent transition-colors">
                {l.label}
              </span>
            </Link>
          ))}
          <a
            href={CALENDLY}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-10 self-start border border-cream/25 px-6 py-4 font-lamam text-xs uppercase tracking-widest text-cream hover:bg-cream hover:text-ink transition-colors"
          >
            BOOK A STRATEGY CALL ↗
          </a>
        </nav>
      )}
    </>
  )
}
