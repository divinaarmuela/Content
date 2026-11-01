'use client'

import { useEffect, useState } from 'react'

type Link = readonly [string, string]

/** The phone menu: a button under 860px that opens every link the desktop bar has. */
export default function MdNavMenu({ services, links, cta }: { services: readonly Link[]; links: readonly Link[]; cta: string }) {
  const [open, setOpen] = useState(false)

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
        <div id="mdnav-sheet" className="mdnav-sheet" role="dialog" aria-modal="true" aria-label="Menu">
          <p className="mdnav-mono mdnav-sheet-label">Services</p>
          {services.map(([name, href]) => <a key={href} href={href} onClick={() => setOpen(false)}>{name}</a>)}
          <p className="mdnav-mono mdnav-sheet-label">MD Media</p>
          {links.map(([name, href]) => <a key={href} href={href} onClick={() => setOpen(false)}>{name}</a>)}
          <div className="mdnav-sheet-bar"><a href={cta} target="_blank" rel="noreferrer noopener" className="mdnav-sheet-cta mdnav-mono">Book a call ↗</a></div>
        </div>
      )}
    </>
  )
}
