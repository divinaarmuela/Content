'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * The navbar's scroll behaviour (owner, 6 Nov 2026): scrolling DOWN slides it away, scrolling UP brings it back
 * as frosted glass. At the very top of the page it sits as before — clear over a dark hero, or on its dark band.
 * Small movements (under 6px) are ignored so it does not flicker on a trackpad.
 */
export default function MdNavScroll({ band, children }: { band: boolean; children: React.ReactNode }) {
  const [hidden, setHidden] = useState(false)
  const [glass, setGlass] = useState(false)
  const last = useRef(0)

  useEffect(() => {
    let frame = 0
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const y = window.scrollY
        const delta = y - last.current
        if (y < 80) { setHidden(false); setGlass(false) }
        else if (delta > 6) setHidden(true)
        else if (delta < -6) { setHidden(false); setGlass(true) }
        if (Math.abs(delta) > 6 || y < 80) last.current = y
      })
    }
    last.current = window.scrollY
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame) }
  }, [])

  return (
    <>
      {/* the band keeps its 64px in the page so nothing slides under the fixed bar */}
      {band && <div aria-hidden className="mdnav-spacer" />}
      <div className={`mdnav-float${band ? ' is-band' : ''}${hidden ? ' is-hidden' : ''}${glass ? ' is-glass' : ''}`}>
        {children}
      </div>
    </>
  )
}
