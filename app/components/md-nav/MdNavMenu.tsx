'use client'

import { useEffect, useRef, useState } from 'react'

type Link = readonly [string, string]

/** The phone menu: a button under 860px that opens every link the desktop bar has. */
export default function MdNavMenu({ services, links, cta }: { services: readonly Link[]; links: readonly Link[]; cta: string }) {
  const [open, setOpen] = useState(false)
  // A SCROLL BAR YOU CAN SEE (the owner, 1 Nov 2026: "add a side scrollbar so they know that they can scroll") —
  // phones hide their own until the list is touched, so the sheet draws one: where you are, and how much is left
  const sheet = useRef<HTMLDivElement>(null)
  const [bar, setBar] = useState<{ top: number; size: number } | null>(null)
  useEffect(() => {
    const el = sheet.current
    if (!open || !el) { setBar(null); return }
    const measure = () => {
      const { scrollTop, scrollHeight, clientHeight } = el
      setBar(scrollHeight > clientHeight + 1 ? { top: scrollTop / scrollHeight, size: clientHeight / scrollHeight } : null)
    }
    measure()
    el.addEventListener('scroll', measure, { passive: true })
    window.addEventListener('resize', measure)
    return () => { el.removeEventListener('scroll', measure); window.removeEventListener('resize', measure) }
  }, [open])

  useEffect(() => {
    // stop the page (and Lenis) scrolling behind the open sheet
    const root = document.documentElement
    root.style.overflow = open ? 'hidden' : ''
    const lenis = (window as unknown as { lenis?: { stop?: () => void; start?: () => void } }).lenis
    if (open) { if (typeof lenis?.stop === 'function') lenis.stop() }
    else if (typeof lenis?.start === 'function') lenis.start()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => { root.style.overflow = ''; window.removeEventListener('keydown', onKey) }
  }, [open])

  return (
    <>
      <button type="button" className="mdnav-burger" aria-expanded={open} aria-controls="mdnav-sheet" aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen(o => !o)}>
        <span /><span />
      </button>
      {open && (
        <div id="mdnav-sheet" ref={sheet} className="mdnav-sheet" role="dialog" aria-modal="true" aria-label="Menu">
          <p className="mdnav-mono mdnav-sheet-label">Services</p>
          {services.map(([name, href]) => <a key={href} href={href} onClick={() => setOpen(false)}>{name}</a>)}
          <p className="mdnav-mono mdnav-sheet-label">MD Media</p>
          {links.map(([name, href]) => <a key={href} href={href} onClick={() => setOpen(false)}>{name}</a>)}
          {bar && <span className="mdnav-sheet-track" aria-hidden="true"><span style={{ top: `${bar.top * 100}%`, height: `${bar.size * 100}%` }} /></span>}
          <div className="mdnav-sheet-bar"><a href={cta} target="_blank" rel="noreferrer noopener" className="mdnav-sheet-cta mdnav-mono">Book a call ↗</a></div>
        </div>
      )}
    </>
  )
}
