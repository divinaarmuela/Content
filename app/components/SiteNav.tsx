'use client'

import { useEffect, useState } from 'react'

function NavLogo() {
  const [ok, setOk] = useState(true)
  return (
    <a href="/" className="site-nav-name" aria-label="MD Media Marketing home">
      {ok ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/MDLogo-trim.png"
          alt="MD Media Marketing"
          className="nav-logo-img"
          onError={() => setOk(false)}
        />
      ) : (
        'MD Media Marketing'
      )}
    </a>
  )
}

type Lenis = { scrollTo: (target: number | string | HTMLElement, opts?: Record<string, unknown>) => void }

export default function SiteNav() {
  const [scrolled,   setScrolled]   = useState(false)
  const [hidden,     setHidden]     = useState(false)
  const [overVideo,  setOverVideo]  = useState(false)

  useEffect(() => {
    let lastY = window.scrollY

    const onScroll = () => {
      const y = window.scrollY
      setScrolled(y > 40)
      if (y < 80) {
        setHidden(false)
      } else {
        setHidden(y > lastY)
      }
      lastY = y

      // transparent when scrolled over the video-stack section
      const vs = document.querySelector('.video-stack') as HTMLElement | null
      if (vs) {
        const rect = vs.getBoundingClientRect()
        setOverVideo(rect.top < 80 && rect.bottom > 0)
      }
    }

    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
    }
  }, [])

  // In-page anchor nav. On the home page a scroll-jacked SilkTransition sits
  // between the top and these sections and would hijack a plain hash jump, so
  // we hand it off to the transition (it bypasses itself and lands us there).
  // Elsewhere there's no transition, so we just smooth-scroll to the target.
  const handleAnchor = (e: React.MouseEvent<HTMLAnchorElement>, hash: string) => {
    const el = document.querySelector(hash) as HTMLElement | null
    if (!el) return // section not on this page — let the default href run
    e.preventDefault()
    if (document.querySelector('.silk-canvas')) {
      window.dispatchEvent(new CustomEvent('nav-goto', { detail: hash }))
      return
    }
    const y = el.getBoundingClientRect().top + window.scrollY
    const lenis = (window as unknown as { __lenis?: Lenis }).__lenis
    if (lenis) lenis.scrollTo(y)
    else window.scrollTo({ top: y, behavior: 'smooth' })
  }

  return (
    <header className={`site-nav${scrolled ? ' is-scrolled' : ''}${hidden ? ' is-hidden' : ''}${overVideo ? ' is-over-video' : ''}`}>
      <div className="site-nav-bg" aria-hidden="true" />
      <div className="site-nav-inner">
        <NavLogo />
        <nav className="site-nav-links" aria-label="Primary">
          <a href="#services" onClick={e => handleAnchor(e, '#services')}>Services</a>
          <a href="#contact" onClick={e => handleAnchor(e, '#contact')}>Contact</a>
        </nav>
      </div>
    </header>
  )
}
