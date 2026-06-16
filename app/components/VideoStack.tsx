'use client'

import { useEffect, useRef, useState } from 'react'

const videos = [
  { src: '/cecconis.mp4',          title: 'Cecconis',          poster: '/cecconis-poster.jpg', preload: 'auto'     as const },
  { src: '/Automodellista.mp4',    title: 'Automodellista',   poster: '/auto-frame0.jpg',     preload: 'metadata' as const },
  { src: '/Pattons.mp4', title: 'Pattons', poster: '/pattons-poster.jpg', preload: 'metadata' as const },
]

function IconMuted() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" />
    </svg>
  )
}
function IconLow() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  )
}
function IconHigh() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  )
}

export default function VideoStack() {
  const vidRefs    = useRef<HTMLVideoElement[]>([])
  const sectionRef = useRef<HTMLElement>(null)
  const capRef     = useRef<HTMLDivElement>(null)
  const [volume, setVolume]       = useState(0)      // 0 = muted by default
  const lastVolRef                = useRef(0.8)       // restored when un-muting
  const volumeRef                 = useRef(0)         // always-current value for callbacks
  const activeIdxRef              = useRef(-1)        // shared between observers so re-entry re-triggers play
  const sectionLiveRef            = useRef(false)     // false while strips are covering/leaving the section

  const applyVolume = (v: number) => {
    volumeRef.current = v
    vidRefs.current.forEach(vid => {
      if (!vid) return
      vid.muted  = v === 0
      vid.volume = v
    })
  }

  const handleSlider = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value)
    if (v > 0) lastVolRef.current = v
    setVolume(v)
    applyVolume(v)
  }

  const toggleMute = () => {
    if (volume > 0) {
      lastVolRef.current = volume
      setVolume(0)
      applyVolume(0)
    } else {
      const restore = lastVolRef.current || 0.8
      setVolume(restore)
      applyVolume(restore)
    }
  }

  // nav transparency via IntersectionObserver (visual only — NOT used for play/pause)
  useEffect(() => {
    const el = sectionRef.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => { document.body.classList.toggle('video-active', entry.isIntersecting) },
      { threshold: 0.01 }
    )
    io.observe(el)
    return () => { io.disconnect(); document.body.classList.remove('video-active') }
  }, [])

  // SilkTransition events: pause immediately when strips close, resume when they open.
  // This is the ONLY reliable signal — the canvas is position:fixed so IntersectionObserver
  // never fires "not intersecting" while the strips are covering the section.
  useEffect(() => {
    const pauseAll = () => {
      sectionLiveRef.current = false          // gate: stop rAF loop from re-playing
      activeIdxRef.current   = -1
      vidRefs.current.forEach(v => { if (v) v.pause() })
    }
    const resumeActive = () => {
      sectionLiveRef.current = true           // gate: allow rAF loop to play again
      const i   = Math.max(0, activeIdxRef.current)
      const vid = vidRefs.current[i]
      if (!vid) return
      vid.muted  = volumeRef.current === 0
      vid.volume = volumeRef.current === 0 ? 1 : volumeRef.current
      vid.play().catch(() => {})
    }
    window.addEventListener('diag-hide', pauseAll)
    window.addEventListener('diag-show', resumeActive)
    return () => {
      window.removeEventListener('diag-hide', pauseAll)
      window.removeEventListener('diag-show', resumeActive)
    }
  }, [])

  // scale-down + darken + cap fade when next panel approaches
  useEffect(() => {
    const section = sectionRef.current
    if (!section) return

    const panels   = Array.from(section.querySelectorAll<HTMLElement>('.video-stack-panel'))
    const overlays = Array.from(section.querySelectorAll<HTMLElement>('.video-stack-overlay'))
    const N        = panels.length
    const TRIGGER_VH = 0.10
    const SCALE_TO   = 0.92
    const DARK_TO    = 0.50

    let rafId      = 0
    let capRendered = -1   // tracks which cap item is currently shown

    const tick = () => {
      const vh           = window.innerHeight
      const slideSpacing = 1.2 * vh
      const rect         = section.getBoundingClientRect()
      const scrolled     = -rect.top

      // show/hide cap based on whether the section is actually in the viewport —
      // more reliable than IntersectionObserver (which fires too late on a tall section)
      if (capRef.current) {
        const want = (rect.top < vh && rect.bottom > 0) ? '1' : '0'
        if (capRef.current.style.opacity !== want) capRef.current.style.opacity = want
      }

      // only play/pause from scroll when the section is live (not mid-transition)
      if (sectionLiveRef.current) {
        const newActive = Math.min(N - 1, Math.max(0, Math.floor(scrolled / slideSpacing)))
        if (newActive !== activeIdxRef.current) {
          activeIdxRef.current = newActive
          vidRefs.current.forEach((vid, i) => {
            if (!vid) return
            if (i === activeIdxRef.current) {
              vid.muted  = volumeRef.current === 0
              vid.volume = volumeRef.current === 0 ? 1 : volumeRef.current
              vid.play().catch(() => {})
            } else {
              vid.pause()
            }
          })
        }
      }

      // crossfade the fixed title when the active index changes
      if (activeIdxRef.current !== capRendered && capRef.current) {
        capRendered = activeIdxRef.current
        const items = capRef.current.children
        for (let j = 0; j < items.length; j++) {
          (items[j] as HTMLElement).style.opacity = j === capRendered ? '1' : '0'
        }
      }

      for (let i = 0; i < N - 1; i++) {
        const animEnd   = (i + 1) * slideSpacing
        const animStart = animEnd - TRIGGER_VH * vh
        const progress  = Math.max(0, Math.min(1, (scrolled - animStart) / (animEnd - animStart)))

        const scale = 1 - progress * (1 - SCALE_TO)
        const pushY = progress * 24
        panels[i].style.transform = `translateY(${pushY.toFixed(1)}px) scale(${scale.toFixed(4)})`
        overlays[i].style.opacity = (progress * DARK_TO).toFixed(4)
      }

      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [])

  const icon = volume === 0 ? <IconMuted /> : volume < 0.5 ? <IconLow /> : <IconHigh />

  return (
    <section ref={sectionRef} className="video-stack" aria-label="Our work">

      {/* volume controls — fixed top-right, below nav */}
      <div className="video-vol-ctrl">
        {volume > 0 && (
          <input
            className="video-vol-slider"
            type="range"
            min="0" max="1" step="0.02"
            value={volume}
            onChange={handleSlider}
            aria-label="Volume"
          />
        )}
        <button className="video-vol-btn" onClick={toggleMute} aria-label={volume === 0 ? 'Unmute' : 'Mute'}>
          {icon}
        </button>
      </div>

      {/* single fixed title — all items stacked; JS crossfades opacity on active change */}
      <div ref={capRef} className="video-stack-fixed-cap" aria-hidden="true">
        {videos.map((v, i) => (
          <div key={i} className="video-stack-cap-item">
            <span className="video-stack-num">
              {String(i + 1).padStart(2, '0')} / {String(videos.length).padStart(2, '0')}
            </span>
            <h3 className="video-stack-title">{v.title}</h3>
          </div>
        ))}
      </div>

      {videos.map((v, i) => (
        <div key={i} className="video-stack-slide">
          <div className="video-stack-panel" style={{ zIndex: i + 1 }}>
            <video
              ref={(el) => { if (el) vidRefs.current[i] = el }}
              className="video-stack-media"
              muted loop playsInline
              preload={v.preload}
              poster={v.poster}
            >
              <source src={v.src} type="video/mp4" />
            </video>

            <div className="video-stack-overlay" aria-hidden="true" />
          </div>
        </div>
      ))}
    </section>
  )
}
