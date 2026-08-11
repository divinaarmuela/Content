'use client'

import { useEffect, useRef } from 'react'
import { media } from '../lib/asset'

const WIX = 'https://static.wixstatic.com/media/'

const PARAGRAPH =
  "We're a Melbourne-based creative agency that builds brands, creates content, and turns digital presence into real business growth. For businesses ready to stop blending in."
const WORDS = PARAGRAPH.split(' ')
const REVEAL_START = 0
const REVEAL_END   = 0.2

const arms = [
  { src: 'c5a69a_8ff71d938a1447a1b0987a2bb9272b1c~mv2.jpg', pos: 'left-0 top-0' },
  { src: 'c5a69a_cb9a54ad31dd4061b2e52c45e33cd36c~mv2.jpg', pos: 'left-[calc(100%/3)] top-0' },
  { src: 'c5a69a_6f5585879dda4f0fa31d352ce2e612cb~mv2.jpg', pos: 'left-[calc(200%/3)] top-0' },
  { src: 'c5a69a_4bc1ab98c0674462a67fea672a7a3d2a~mv2.jpg', pos: 'left-0 top-[calc(100%/3)]' },
  { src: 'c5a69a_ad4957b0df6b4257b3a20ac240a39348~mv2.jpg', pos: 'left-[calc(200%/3)] top-[calc(100%/3)]' },
  { src: 'c5a69a_142a963c514f4e789ed0b63123dfd7af~mv2.jpg', pos: 'left-0 top-[calc(200%/3)]' },
  { src: 'c5a69a_301debe79d924d1485598c4f5f601013~mv2.jpg', pos: 'left-[calc(100%/3)] top-[calc(200%/3)]' },
  { src: 'c5a69a_cbe685f642bb4d75b6f9b0759d5482e2~mv2.jpg', pos: 'left-[calc(200%/3)] top-[calc(200%/3)]' },
]

const projects = [
  { title: 'Cutter & Co',        tag: 'Finance / Mortgage', year: '2025', img: 'c5a69a_8ff71d938a1447a1b0987a2bb9272b1c~mv2.jpg' },
  { title: 'Senorita Debutante', tag: 'Fashion / Events',   year: '2025', img: 'c5a69a_cb9a54ad31dd4061b2e52c45e33cd36c~mv2.jpg' },
  { title: 'MGMT Aus',           tag: 'Debt / Finance',     year: '2024', img: 'c5a69a_6f5585879dda4f0fa31d352ce2e612cb~mv2.jpg' },
  { title: 'Automodellista',     tag: 'Automotive',         year: '2025', img: 'c5a69a_4bc1ab98c0674462a67fea672a7a3d2a~mv2.jpg' },
  { title: 'MD Studio',          tag: 'Brand Film',         year: '2026', img: 'c5a69a_ad4957b0df6b4257b3a20ac240a39348~mv2.jpg' },
]

/** Clamp value to [0, 1] */
const c01 = (x: number) => Math.max(0, Math.min(1, x))

/** Multi-stop linear remap (like Framer's useTransform) */
function remap(p: number, ins: number[], outs: number[]) {
  if (p <= ins[0]) return outs[0]
  for (let i = 0; i < ins.length - 1; i++) {
    if (p <= ins[i + 1]) {
      const t = (p - ins[i]) / (ins[i + 1] - ins[i])
      return outs[i] + t * (outs[i + 1] - outs[i])
    }
  }
  return outs[outs.length - 1]
}

export default function FilmHero() {
  const trackRef     = useRef<HTMLElement>(null)
  const gridRef      = useRef<HTMLDivElement>(null)
  const darkenRef    = useRef<HTMLDivElement>(null)
  const titleRef     = useRef<HTMLHeadingElement>(null)
  const drawerRef    = useRef<HTMLDivElement>(null)
  const drawerImgRef = useRef<HTMLImageElement>(null)
  const cardsRef     = useRef<HTMLDivElement>(null)
  const armImgRefs   = useRef<HTMLImageElement[]>([])
  const wordRefs     = useRef<HTMLSpanElement[]>([])

  useEffect(() => {
    const track = trackRef.current
    if (!track) return

    let trackH = track.offsetHeight - window.innerHeight
    const onResize = () => { trackH = track.offsetHeight - window.innerHeight }
    window.addEventListener('resize', onResize)

    const n   = WORDS.length
    let lastY = -1
    let lastP = -1  // skip when clamped (scrolled past hero)

    let rafId: number
    function loop() {
      rafId = requestAnimationFrame(loop)

      const y = window.scrollY
      if (y === lastY) return
      lastY = y

      const p = c01(y / trackH)

      // Always update grid — keeps the GPU layer warm so it's never evicted
      // while the user scrolls in other sections (prevents re-creation lag on re-entry)
      const gs = remap(p, [0, 0.12, 0.28, 0.42], [3.7, 1, 1, 0.92])
      gridRef.current!.style.transform = `scale3d(${gs},${gs},1)`

      if (p === lastP) return   // past the hero — skip all other DOM writes
      lastP = p

      // ── arm images — direct refs, no CSS-var recalc ───────────
      // only changes in the zoom-out phase (p 0→0.12)
      if (p <= 0.13) {
        const imgS = remap(p, [0, 0.12], [1.25, 1])
        armImgRefs.current.forEach(img => {
          if (img) img.style.transform = `scale3d(${imgS},${imgS},1)`
        })
      }

      // ── overlay + title (only change near top) ────────────────
      darkenRef.current!.style.opacity = String(0.22 + c01(p / 0.18) * 0.53)
      if (p <= 0.06)
        titleRef.current!.style.opacity = String(1 - c01(p / 0.05))

      // ── word reveal (only in 0→0.2 range) ────────────────────
      if (p <= REVEAL_END + 0.02) {
        wordRefs.current.forEach((span, i) => {
          if (!span) return
          const s = REVEAL_START + (REVEAL_END - REVEAL_START) * (i / n)
          const e = REVEAL_START + (REVEAL_END - REVEAL_START) * ((i + 1) / n)
          span.style.opacity = String(c01((p - s) / (e - s)))
        })
      }

      // ── drawer + cards (only in lower half of hero) ───────────
      if (p >= 0.26) {
        drawerRef.current!.style.transform =
          `translate3d(0,${remap(p, [0.28, 0.42], [100, 0])}%,0)`
        const ds = remap(p, [0.28, 0.42], [1.18, 1])
        drawerImgRef.current!.style.transform = `scale3d(${ds},${ds},1)`
      }
      if (p >= 0.44) {
        cardsRef.current!.style.transform =
          `translate3d(${remap(p, [0.46, 0.96], [0, -72])}vw,0,0)`
      }
    }

    rafId = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  return (
    <section ref={trackRef} className="relative h-[440vh] border-0 bg-black p-0">
      <div className="sticky top-0 h-[100svh] min-h-[560px] overflow-hidden bg-black">

        {/* ── 3×3 grid + video ───────────────────────────────────── */}
        <div
          ref={gridRef}
          className="absolute inset-0 z-[1] origin-center will-change-transform"
          style={{ transform: 'scale3d(3.7,3.7,1)' }}
        >
          <div className="absolute left-[calc(100%/3)] top-[calc(100%/3)] z-[1] h-[calc(100%/3)] w-[calc(100%/3)] overflow-hidden bg-black [border:5px_solid_transparent]">
            <video
              className="absolute inset-0 h-full w-full object-cover"
              autoPlay muted loop playsInline preload="auto" poster="/hero-poster.jpg"
            >
              <source src={media('website-landscape.mp4')} type="video/mp4" />
            </video>
          </div>
          {arms.map((a, i) => (
            <div
              key={a.pos}
              className={`absolute h-[calc(100%/3)] w-[calc(100%/3)] overflow-hidden [border:5px_solid_transparent] ${a.pos}`}
            >
              <img
                ref={el => { if (el) armImgRefs.current[i] = el }}
                className="h-full w-full origin-center object-cover"
                style={{ transform: 'scale3d(1.25,1.25,1)' }}
                src={`${WIX}${a.src}`}
                alt="" aria-hidden="true"
              />
            </div>
          ))}
        </div>

        {/* ── Dark overlay ───────────────────────────────────────── */}
        <div
          ref={darkenRef}
          className="absolute inset-0 z-[2] bg-black pointer-events-none"
          style={{ opacity: 0.22 }}
          aria-hidden="true"
        />

        {/* ── Title ──────────────────────────────────────────────── */}
        <div className="absolute inset-0 z-[3] flex flex-col justify-end text-white pointer-events-none [mix-blend-mode:difference]">
          <h1
            ref={titleRef}
            className="m-0 flex flex-col whitespace-nowrap font-sans font-medium leading-[0.9] tracking-[-0.04em] text-[clamp(44px,9.5vw,168px)] pr-[clamp(8px,1.5vw,20px)] pb-[clamp(8px,1.4vw,22px)] pl-[clamp(12px,2vw,28px)]"
          >
            <span className="block">Melbourne</span>
            <span className="block">Growth Agency</span>
          </h1>
        </div>

        {/* ── Word-reveal paragraph ──────────────────────────────── */}
        <div className="absolute inset-0 z-[4] flex items-center justify-center px-[clamp(24px,8vw,220px)] pointer-events-none">
          <p className="max-w-[1100px] text-center font-sans font-normal leading-[1.4] tracking-[-0.01em] text-white text-[clamp(20px,2.5vw,40px)] [text-shadow:0_2px_24px_rgba(0,0,0,0.6)]">
            {WORDS.map((w, i) => (
              <span
                key={i}
                ref={el => { if (el) wordRefs.current[i] = el }}
                style={{ opacity: 0 }}
              >
                {w}{' '}
              </span>
            ))}
          </p>
        </div>

        <div className="filmhero-grain" aria-hidden="true" />

        {/* ── Drawer (Projects panel) ────────────────────────────── */}
        <div
          ref={drawerRef}
          className="absolute inset-0 z-[50] overflow-hidden will-change-transform [box-shadow:0_-40px_120px_rgba(0,0,0,0.65)]"
          style={{ transform: 'translate3d(0,100%,0)' }}
        >
          <img
            ref={drawerImgRef}
            className="absolute inset-0 h-full w-full object-cover"
            style={{ transform: 'scale3d(1.18,1.18,1)' }}
            src="/image2.jpg"
            alt="" aria-hidden="true"
          />
          <div className="absolute inset-0 bg-[#0c0c0c]/70" />

          <div className="absolute left-0 right-0 top-0 z-10 flex items-start justify-between px-[clamp(20px,5vw,80px)] pt-[clamp(96px,14vh,150px)]">
            <h2 className="font-sans font-medium leading-none tracking-[-0.03em] text-[clamp(48px,9vw,140px)] text-[#0057FF]">
              Projects
            </h2>
            <a
              href="/work"
              className="mt-3 shrink-0 rounded-full border border-white/40 px-5 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-white transition-colors hover:border-white"
            >
              View all projects
            </a>
          </div>

          <div
            ref={cardsRef}
            className="absolute bottom-[clamp(48px,12vh,120px)] left-0 flex gap-[clamp(16px,2vw,32px)] pl-[clamp(20px,5vw,80px)] pr-[10vw] will-change-transform"
            style={{ transform: 'translateX(0vw)' }}
          >
            {projects.map((p) => (
              <article key={p.title} className="w-[clamp(260px,32vw,440px)] shrink-0">
                <div className="aspect-[4/3] w-full overflow-hidden">
                  <img
                    src={`${WIX}${p.img}`}
                    alt={p.title}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                </div>
                <h3 className="mt-3 font-mono text-[12px] uppercase tracking-[0.1em] text-white">
                  {p.title}
                </h3>
                <p className="mt-1 font-mono text-[11px] text-white/50">
                  {p.tag} &middot; {p.year}
                </p>
              </article>
            ))}
          </div>
        </div>

      </div>
    </section>
  )
}
