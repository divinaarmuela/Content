'use client'
import { useEffect, useRef, useState } from 'react'
import { asset } from '../lib/asset'

// Layout constants (must match globals.css .hvs-wrap / .hvs-track / .hvs-divider)
// Track: 5 videos (100vw each) + 5 dividers (55vw each) = 775vw total
// Travel: 775vw - 100vw = 675vw  →  wrapper height = calc(675vw + 100svh)
const DIVIDER_RATIO = 0.55   // 55vw

const slides = [
  {
    src:     asset('/cecconis.mp4'),
    poster:  '/cecconis-poster.jpg',
    preload: 'none'     as const,
    title:   'Cecconis',
    num:     '01',
    client:  "Cecconi's Toorak & Flinders",
    category:'Fine Dining',
    desc:    "Editorial photography and content for two of Melbourne's most recognised fine dining venues.",
    photos:  ['/Cecconi1.jpg'],
  },
  {
    src:     asset('/Senorita.mp4'),
    poster:  '/Senorita.jpg',
    preload: 'none' as const,
    title:   'Señorita',
    num:     '02',
    client:  'Señorita Debutante',
    category:'Fashion & Events',
    desc:    'Zero to fully booked. A fashion debut turned into a sold-out events calendar.',
    photos:  ['/Senorita.jpg'],
    photoPos: 'center 50%',
  },
  {
    src:     asset('/Pattons.mp4'),
    poster:  '/pattons-poster.jpg',
    preload: 'none' as const,
    title:   'Pattons',
    num:     '03',
    client:  'Pattons',
    category:'Hospitality',
    desc:    'Monthly content and social management for a Melbourne hospitality institution.',
    photos:  ['/Pattons.jpg'],
    startAt: 2,
  },
  {
    src:     asset('/Park%20Noire%20Website.mp4'),
    preload: 'none' as const,
    title:   'Park Noire',
    num:     '04',
    client:  'Park Noire',
    category:'Hospitality & Nightlife',
    desc:    'A boutique Melbourne venue, with an identity built around atmosphere, not just aesthetics.',
    photos:  ['/PARK-NOIR_006%20copy.jpg'],
    photoPos: 'center 35%',
  },
  {
    src:     asset('/Waterside%20Website%20(1).mp4'),
    preload: 'none' as const,
    title:   'Waterside Hotel',
    num:     '05',
    client:  'Waterside Hotel',
    category:'Venue & Events',
    desc:    'A full marketing retainer for a Melbourne waterfront venue, framed across day and night.',
    photos:  ['/DSC01591.jpg'],
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
  const warmedRef   = useRef<Set<number>>(new Set())

  // Predictive preload: videos ship with preload="none" so they cost nothing on
  // initial page load. We upgrade a clip to a full download only once it's about
  // to be needed — the first one as the section approaches, and each subsequent
  // one while the previous is playing — so each is buffered by the time it's on
  // screen without ever loading all five at once.
  const warmVideo = (i: number) => {
    const vid = vidRefs.current[i]
    if (!vid || warmedRef.current.has(i)) return
    warmedRef.current.add(i)
    vid.preload = 'auto'
    vid.load()
  }

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

  // Warm the first clip while the section is still ~2 viewports away, so it's
  // buffered before the scroll transition finishes revealing it.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { warmVideo(0); io.disconnect() } },
      { rootMargin: '200% 0px 200% 0px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // SilkTransition gate: pause on diag-hide, resume on diag-show.
  // Also auto-enable if the section is already visible on load (e.g. direct
  // navigation or macOS native-scroll landing mid-page without a transition).
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

    // Fallback: if the HVS section is already in the viewport on mount (no
    // SilkTransition animation played), enable video playback immediately.
    const el = wrapRef.current
    if (el) {
      const rect = el.getBoundingClientRect()
      if (rect.top < window.innerHeight && rect.bottom > 0) {
        liveRef.current = true
      }
    }

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
      // Warm-ahead: start each clip downloading ~1.2 viewports before it scrolls
      // into view, so it's buffered by the time it's on screen (no black frame).
      const warmIO = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => {
            if (!e.isIntersecting) return
            const idx = vidRefs.current.indexOf(e.target as HTMLVideoElement)
            warmVideo(idx)
            warmVideo(idx + 1)
          })
        },
        { rootMargin: '120% 0px 120% 0px' }
      )
      vidRefs.current.forEach((v) => v && warmIO.observe(v))

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

      return () => { warmIO.disconnect(); vidIO.disconnect(); divIO.disconnect() }
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

        // Scroll-linked opacity: each divider fades in as its leading edge
        // travels left into the viewport and fades back out on reverse scroll.
        // divLeft = on-screen x of the divider's left edge. Fully opaque once
        // it has scrolled halfway across the viewport.
        const d = dividerRefs.current[i]
        if (d) {
          const divLeft = (i * PERIOD + VW) - progress
          const op = Math.max(0, Math.min(1, (VW - divLeft) / (VW * 0.5)))
          d.style.opacity = op.toFixed(3)
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
          warmVideo(newActive)          // ensure the active clip is downloading
          warmVideo(newActive + 1)      // and buffer the next one ahead of arrival
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

  // Pre-decode only the FIRST divider's photos on mount so they're GPU-ready
  // before the user scrolls to the Cecconis card — eliminates the synchronous
  // decode that would otherwise block the frame when the reveal fires. Later
  // dividers lazy-load (loading="lazy"), so we don't force their fetch here.
  useEffect(() => {
    const first = dividerRefs.current[0]
    if (!first) return
    const imgs = first.querySelectorAll<HTMLImageElement>('.hvs-d-photo')
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
                      // Only the first divider's photos load up front; the rest
                      // lazy-load as the user scrolls toward them, so they don't
                      // compete with the hero/first clip on initial page load.
                      const loading = i === 0 ? 'eager' : 'lazy'
                      const fp      = i === 0 ? 'high' : 'low'
                      return (
                        <>
                          <img src={s.photos[0]} alt="" className="hvs-d-photo hvs-d-p1" decoding="async" loading={loading} fetchPriority={fp} style={pos} />
                          {s.photos[1] && <img src={s.photos[1]} alt="" className="hvs-d-photo hvs-d-p2" decoding="async" loading={loading} fetchPriority={fp} style={pos} />}
                          {s.photos[2] && <img src={s.photos[2]} alt="" className="hvs-d-photo hvs-d-p3" decoding="async" loading={loading} fetchPriority={fp} style={pos} />}
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
