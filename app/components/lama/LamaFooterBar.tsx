'use client'

import { useEffect, useRef, useState } from 'react'
import { ScrollGlitch } from './Scramble'
import { useLamaReady } from './ready'

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
      [ <span className="inline-block h-1 w-1 rounded-full bg-[red]" />
      {now ? `${p(now.getHours())} : ${p(now.getMinutes())} : ${p(now.getSeconds())}` : '00 : 00 : 00'} ]
    </span>
  )
}

// Reference-site sticky bar: a rule line + mono metadata pinned to the
// bottom of the hero. It draws in after the preloader, the labels churn as
// glyphs while scrolling, and past the hero the whole bar glitches away —
// the line collapses to scaleX(0) from the left and the labels scramble out.
// It returns when the visitor reaches the end of the page.
export default function LamaFooterBar() {
  const ready = useLamaReady()
  const [scrolling, setScrolling] = useState(false)
  const [hidden, setHidden] = useState(false)
  const idleTimer = useRef(0)

  useEffect(() => {
    const onScroll = () => {
      setScrolling(true)
      window.clearTimeout(idleTimer.current)
      idleTimer.current = window.setTimeout(() => setScrolling(false), 150)
      // reference behaviour: the bar glitches away the moment the visitor
      // leaves the very top, and only returns once fully back at the top
      setHidden(window.scrollY > 40)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => { window.removeEventListener('scroll', onScroll); window.clearTimeout(idleTimer.current) }
  }, [])

  const visible = ready && !hidden

  return (
    <div className="fixed inset-0 z-[90] hidden sm:flex items-end pointer-events-none px-6 sm:px-10">
      <div className="relative mb-4 flex w-full items-center pt-3">
        <div
          className={`absolute left-0 right-0 top-0 h-px bg-cream origin-left transition-transform duration-700 ease-out ${visible ? 'scale-x-100' : 'scale-x-0'}`}
        />
        <div
          className={`flex w-full items-center font-lamam text-[11px] uppercase tracking-wider text-cream transition-opacity duration-500 ${visible ? 'opacity-100 delay-150 [&_a]:pointer-events-auto' : 'opacity-0'}`}
        >
          <span className="lg:w-2/12"><ScrollGlitch text="EST. 2024" scrambling={scrolling || !visible} /></span>
          <span className="lg:w-2/12"><ScrollGlitch text="MELBOURNE BASED" scrambling={scrolling || !visible} /></span>
          <span className="hidden lg:block lg:w-4/12"><Clock /></span>
          <span className="ml-auto flex items-center gap-10">
            <ScrollGlitch text="FOLLOW US" scrambling={scrolling || !visible} className="text-cream-dim" />
            <a href="https://www.instagram.com/mdmedia._" target="_blank" rel="noreferrer noopener" className="text-cream visited:text-cream no-underline hover:text-accent transition-colors">
              <ScrollGlitch text="INSTAGRAM +" scrambling={scrolling || !visible} />
            </a>
            <a href="https://www.linkedin.com/company/mdmedia-marketing/" target="_blank" rel="noreferrer noopener" className="text-cream visited:text-cream no-underline hover:text-accent transition-colors">
              <ScrollGlitch text="LINKEDIN +" scrambling={scrolling || !visible} />
            </a>
          </span>
        </div>
      </div>
    </div>
  )
}
