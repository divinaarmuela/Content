'use client'

import { useEffect, useRef, useState } from 'react'
import { ScrollGlitch } from './Scramble'

function Clock() {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    <span className="flex items-center gap-1.5">
      [ <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
      {now ? `${p(now.getHours())} : ${p(now.getMinutes())} : ${p(now.getSeconds())}` : '00 : 00 : 00'} ]
    </span>
  )
}

export default function LamaFooterBar() {
  // true while the user is actively scrolling; items encode into glyphs
  // during that window and decode ~150ms after scrolling stops
  const [scrolling, setScrolling] = useState(false)
  const idleTimer = useRef(0)

  useEffect(() => {
    const onScroll = () => {
      setScrolling(true)
      window.clearTimeout(idleTimer.current)
      idleTimer.current = window.setTimeout(() => setScrolling(false), 150)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => { window.removeEventListener('scroll', onScroll); window.clearTimeout(idleTimer.current) }
  }, [])

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[90] hidden sm:block pointer-events-none">
      <div className="border-t border-cream/10 bg-ink/80 backdrop-blur-sm px-6 py-2.5 flex items-center gap-8 font-lamam text-[11px] uppercase tracking-wider text-cream [&_a]:pointer-events-auto">
        <ScrollGlitch text="EST. 2024" scrambling={scrolling} />
        <ScrollGlitch text="MELBOURNE BASED" scrambling={scrolling} />
        <Clock />
        <span className="ml-auto" />
        <ScrollGlitch text="FOLLOW US" scrambling={scrolling} className="text-cream-dim" />
        <a href="https://www.instagram.com/mdmedia._" target="_blank" rel="noreferrer noopener" className="hover:text-accent transition-colors">
          <ScrollGlitch text="INSTAGRAM +" scrambling={scrolling} />
        </a>
        <a href="https://www.linkedin.com/company/mdmedia-marketing/" target="_blank" rel="noreferrer noopener" className="hover:text-accent transition-colors">
          <ScrollGlitch text="LINKEDIN +" scrambling={scrolling} />
        </a>
      </div>
    </div>
  )
}
