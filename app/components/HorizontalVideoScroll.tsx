'use client'
import { useEffect, useRef, useState } from 'react'
import { asset } from '../lib/asset'

// Layout constants (must match globals.css .hvs-wrap / .hvs-track / .hvs-divider)
// Track: 3 videos (100vw each) + 3 dividers (55vw each) = 465vw total
// Travel: 465vw - 100vw = 365vw  →  wrapper height = calc(365vw + 100svh)
const DIVIDER_RATIO = 0.55   // 55vw

const slides = [
  {
    src:     asset('/cecconis.mp4'),
    poster:  '/cecconis-poster.jpg',
    preload: 'auto'     as const,
    title:   'Cecconis',
    num:     '01',
    client:  'Cecconis Flinders Lane',
    category:'Brand Film',
    desc:    "A cinematic brand story for one of Melbourne's most celebrated Italian restaurants.",
    photos:  [asset('/Cecconi1.jpg'), asset('/Cecconi2.jpg'), asset('/Cecconi3.jpg')],
  },
  {
    src:     asset('/Senorita.mp4'),
    poster:  '/Senorita.jpg',
    preload: 'auto' as const,
    title:   'Señorita',
    num:     '02',
    client:  'Señorita Debutante',
    category:'Debutante',
    desc:    'Debutante dresses by Señorita. A Melbourne fashion story built for a new generation.',
    photos:  ['/Senorita.jpg'],
    photoPos: 'center 50%',
  },
  {
    src:     asset('/Pattons.mp4'),
    poster:  '/pattons-poster.jpg',
    preload: 'auto' as const,
    title:   'Pattons',
    num:     '03',
    client:  'Pattons',
    category:'Venue',
    desc:    'A heritage venue, reframed for a new generation.',
    photos:  ['/Pattons.jpg'],
    startAt: 2,
  },
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

export default function HorizontalVideoScroll() {
  const wrapRef     = useRef<HTMLDivElement>(null)
  const trackRef    = useRef<HTMLDivElement>(null)
  const progressRef = useRef<HTMLDivElement>(null)
  const vidRefs     = useRef<HTMLVideoElement[]>([])
  const dividerRefs = useRef<HTMLDivElement[]>([])
  const activeRef   = useRef(-1)
  const liveRef     = useRef(false)

  const [volume, setVolume] = useState(0)
  const volumeRef  = useRef(0)
  const lastVolRef = useRef(0.8)

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

  // body.video-active drives nav transparency + vol-ctrl visibility
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => { document.body.classList.toggle('video-active', entry.isIntersecting) },
      { threshold: 0.01 }
    )
    io.observe(el)
    return () => { io.disconnect(); document.body.classList.remove('video-active') }
  }, [])

  // SilkTransition gate: pause on diag-hide, resume on diag-show
  useEffect(() => {
    const pauseAll = () => {
      liveRef.current   = false
      activeRef.current = -1
      vidRefs.current.forEach(v => { if (v) v.pause() })
    }
    const resumeActive = () => {
      liveRef.current = true
      const i   = Math.max(0, activeRef.current)
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

  // rAF: drive translateX + play/pause + progress bar
  useEffect(() => {
    const wrap  = wrapRef.current
    const track = trackRef.current
    if (!wrap || !track) return

    const N = slides.length

    // ── small screens: no scroll-jacking. The track stacks vertically (CSS) and
    // the page scrolls normally; play each clip while it's on screen and reveal
    // the divider text via IntersectionObserver instead of the rAF translate. ──
    if (window.matchMedia('(max-width: 768px)').matches) {
      const vidIO = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => {
            const v = e.target as HTMLVideoElement
            if (e.isIntersecting) {
              v.muted = volumeRef.current === 0
              v.volume = volumeRef.current
              v.play().catch(() => {})
            } else {
              v.pause()
            }
          })
        },
        { threshold: 0.55 }
      )
      vidRefs.current.forEach((v) => v && vidIO.observe(v))

      const divIO = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => { if (e.isIntersecting) e.target.classList.add('in-view') })
        },
        { threshold: 0.2 }
      )
      dividerRefs.current.forEach((d) => d && divIO.observe(d))

      return () => { vidIO.disconnect(); divIO.disconnect() }
    }

    let rafId = 0
    const triggered = new Set<number>()   // animate-once per divider

    const tick = () => {
      const VW        = window.innerWidth
      const VH        = window.innerHeight
      const DIVIDER_W = VW * DIVIDER_RATIO          // 35vw in px
      const PERIOD    = VW + DIVIDER_W               // one video+divider cycle
      const trackW    = N * VW + N * DIVIDER_W         // total track width
      const maxPx     = trackW - VW                  // horizontal travel distance

      const rect        = wrap.getBoundingClientRect()
      const rawScrolled = -rect.top                             // negative when section not yet reached
      const progress    = Math.max(0, Math.min(maxPx, rawScrolled))

      track.style.transform = `translateX(-${progress.toFixed(1)}px)`

      if (progressRef.current) {
        progressRef.current.style.width = `${((progress / maxPx) * 100).toFixed(2)}%`
      }

      // Fire as soon as the divider's leading edge enters the viewport.
      // progress = i*PERIOD is the exact moment the card starts appearing from
      // the right; the small buffer avoids an edge-case fire while it's still
      // off-screen. rawScrolled (unclamped) keeps i=0 from firing at page load.
      for (let i = 0; i < N; i++) {
        const threshold = i * PERIOD + DIVIDER_W * 0.08
        if (!triggered.has(i) && rawScrolled >= threshold) {
          triggered.add(i)
          dividerRefs.current[i]?.classList.add('in-view')
        }
      }

      // play whichever video panel the viewport centre is over
      if (liveRef.current) {
        const centerX  = progress + VW * 0.5
        let newActive  = -1
        for (let i = 0; i < N; i++) {
          const panelStart = i * PERIOD
          if (centerX >= panelStart && centerX < panelStart + VW) {
            newActive = i; break
          }
        }
        // if center is on a divider, keep the current video playing
        if (newActive !== -1 && newActive !== activeRef.current) {
          activeRef.current = newActive
          vidRefs.current.forEach((vid, i) => {
            if (!vid) return
            if (i === newActive) {
              vid.muted  = volumeRef.current === 0
              vid.volume = volumeRef.current === 0 ? 1 : volumeRef.current
              vid.play().catch(() => {})
            } else {
              vid.pause()
            }
          })
        }
      }

      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [])

  // Pre-decode divider photos on mount so they're GPU-ready well before the
  // user scrolls to the Cecconis card — eliminates the synchronous decode
  // that otherwise blocks the frame when the reveal fires.
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const imgs = wrap.querySelectorAll<HTMLImageElement>('.hvs-d-photo')
    imgs.forEach(img => {
      const run = () => { img.decode?.().catch(() => {}) }
      if (img.complete) run()
      else img.addEventListener('load', run, { once: true })
    })
  }, [])

  const N    = slides.length
  const icon = volume === 0 ? <IconMuted /> : volume < 0.5 ? <IconLow /> : <IconHigh />

  return (
    // .video-stack class keeps SiteNav transparent + body.video-active wiring intact
    <div ref={wrapRef} className="hvs-wrap video-stack" aria-label="Our work">

      {/* volume control — reuses existing fixed CSS from VideoStack era */}
      <div className="video-vol-ctrl">
        {volume > 0 && (
          <input
            className="video-vol-slider"
            type="range" min="0" max="1" step="0.02"
            value={volume}
            onChange={handleSlider}
            aria-label="Volume"
          />
        )}
        <button className="video-vol-btn" onClick={toggleMute} aria-label={volume === 0 ? 'Unmute' : 'Mute'}>
          {icon}
        </button>
      </div>

      <div className="hvs-sticky">
        <div ref={trackRef} className="hvs-track">
          {slides.flatMap((s, i) => {
            const items = [
              <div key={`v${i}`} className="hvs-panel">
                <video
                  ref={el => {
                    if (!el) return
                    vidRefs.current[i] = el
                    if ('startAt' in s && s.startAt && el.readyState >= 1) {
                      el.currentTime = s.startAt as number
                    } else if ('startAt' in s && s.startAt) {
                      el.addEventListener('loadedmetadata', () => { el.currentTime = s.startAt as number }, { once: true })
                    }
                  }}
                  className="hvs-media"
                  muted loop playsInline
                  preload={s.preload}
                >
                  <source src={s.src} type="video/mp4" />
                </video>
                <div className="hvs-panel-cap" aria-hidden="true">
                  <span className="hvs-cap-num">{s.num} / 0{N}</span>
                  <h3 className="hvs-cap-title">{s.title}</h3>
                </div>
              </div>,
            ]

            // divider after every video — text reveals via .in-view class added by rAF
            items.push(
              <div key={`d${i}`} className="hvs-divider" ref={el => { if (el) dividerRefs.current[i] = el }}>

                {/* photo grid — only when photos are provided (e.g. Cecconis) */}
                {'photos' in s && s.photos && (
                  <div className="hvs-d-photos" aria-hidden="true" data-count={s.photos.length}>
                    {(() => {
                      const pos = 'photoPos' in s && s.photoPos ? { objectPosition: s.photoPos } : undefined
                      return (
                        <>
                          <img src={s.photos[0]} alt="" className="hvs-d-photo hvs-d-p1" decoding="async" loading="eager" style={pos} />
                          {s.photos[1] && <img src={s.photos[1]} alt="" className="hvs-d-photo hvs-d-p2" decoding="async" loading="eager" style={pos} />}
                          {s.photos[2] && <img src={s.photos[2]} alt="" className="hvs-d-photo hvs-d-p3" decoding="async" loading="eager" style={pos} />}
                        </>
                      )
                    })()}
                  </div>
                )}

                <div className="hvs-d-inner">
                  <div className="reveal-mask">
                    <span className="hvs-d-cat reveal-inner" style={{ animationDelay: '0s' }}>{s.category}</span>
                  </div>
                  <div className="reveal-mask">
                    <h3 className="hvs-d-title reveal-inner" style={{ animationDelay: '0.06s' }}>{s.title}</h3>
                  </div>
                  <div className="reveal-mask">
                    <p className="hvs-d-desc reveal-inner" style={{ animationDelay: '0.12s' }}>{s.desc}</p>
                  </div>
                  <div className="reveal-mask">
                    <span className="hvs-d-client reveal-inner" style={{ animationDelay: '0.18s' }}>{s.client}</span>
                  </div>
                </div>
              </div>
            )
            return items
          })}
        </div>

        {/* thin progress bar at bottom of viewport */}
        <div className="hvs-progress-track" aria-hidden="true">
          <div ref={progressRef} className="hvs-progress-bar" />
        </div>
      </div>
    </div>
  )
}
