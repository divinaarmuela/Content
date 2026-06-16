'use client'

import { useRef, useEffect } from 'react'

const STRIPS = 150

const seededRand = (seed: number) => {
  let s = seed
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646 }
}
const rng = seededRand(42)
const WEIGHTS = Array.from({ length: STRIPS }, () => {
  const r = rng()
  if (r < 0.18) return 0.22 + rng() * 0.18
  if (r < 0.30) return 1.4  + rng() * 0.5
  return 0.6 + rng() * 0.7
})
const TOTAL_W = WEIGHTS.reduce((a, b) => a + b, 0)
const JITTER = Array.from({ length: STRIPS }, () => rng())

function hsl(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    return (l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)) * 255
  }
  return [f(0), f(8), f(4)]
}
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const easeInOut = (p: number) => p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2

type Lenis = { stop: () => void; start: () => void; scrollTo: (t: number, o?: { immediate?: boolean }) => void }

/**
 * Three-step silk transition, your spec:
 *   1. GLIMPSE  — a `position: sticky` silk panel floats up between the sections
 *                 as you scroll. Composited by the browser → zero lag on mobile,
 *                 no background (the silk is the only thing there).
 *   2. SNAP     — the moment the silk fully covers, a fixed full-screen silk takes
 *                 over and the page snaps behind it to the target section.
 *   3. REVEAL   — the fixed silk dissolves to uncover the snapped section.
 * Steps 2–3 are time-driven over a full-screen cover (not scroll-tracked), so they
 * don't lag either. Nothing is glued to live scrollY, so mobile can't desync it.
 */
export default function SilkTransition() {
  const runwayRef  = useRef<HTMLDivElement>(null)
  const glimpseRef = useRef<HTMLCanvasElement>(null)
  const coverRef   = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const runway  = runwayRef.current
    const gCanvas = glimpseRef.current
    const cCanvas = coverRef.current
    if (!runway || !gCanvas || !cCanvas) return
    const gctx = gCanvas.getContext('2d')!
    const cctx = cCanvas.getContext('2d')!
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const HOLD     = reduceMotion ? 0   : 140
    const DISSOLVE = reduceMotion ? 160 : 740

    let W = 0, H = 0, lastW = -1
    const xs = new Float32Array(STRIPS)
    const ws = new Float32Array(STRIPS)
    const order = new Float32Array(STRIPS)

    const sizeCanvas = (c: HTMLCanvasElement, ctx: CanvasRenderingContext2D) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      c.width = W * dpr; c.height = H * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    const layout = () => {
      W = window.innerWidth
      H = window.innerHeight
      sizeCanvas(gCanvas, gctx)
      sizeCanvas(cCanvas, cctx)
      // runway just over a viewport → the glimpse rises ~one screen, then commits
      // the instant it fully covers. width-gated so the mobile address bar doesn't churn it.
      if (W !== lastW) { runway.style.height = Math.round(H * 1.1) + 'px'; lastW = W }
      let x = 0
      const cx = W / 2
      for (let i = 0; i < STRIPS; i++) {
        xs[i] = x
        ws[i] = i < STRIPS - 1 ? Math.ceil((WEIGHTS[i] / TOTAL_W) * W) : W - x
        const mid = x + ws[i] / 2
        order[i] = clamp01((Math.abs(mid - cx) / cx) * 0.82 + JITTER[i] * 0.18)
        x += ws[i]
      }
    }
    layout()
    window.addEventListener('resize', layout)

    const getLenis = () => (window as unknown as { __lenis?: Lenis }).__lenis

    const stripColor = (i: number, t: number): string => {
      const nx = (xs[i] + ws[i] / 2) / W
      const drift = t * 0.16
      const n =
        Math.sin((nx * 2.2 + drift)             * 6.2832) * 0.55 +
        Math.sin((nx * 5.7 - drift * 1.3 + 0.7) * 6.2832) * 0.30 +
        Math.sin((nx * 11.0 + drift * 0.8 + 2.1) * 6.2832) * 0.15
      const v = clamp01(0.5 + n * 0.5 + (JITTER[i] - 0.5) * 0.03)
      const light = 0.30 + Math.pow(v, 1.2) * 0.54
      const hue   = 214 - v * 18
      const sat   = 0.88 - Math.pow(v, 2.5) * 0.45
      const c = hsl(hue, sat, light)
      return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`
    }
    const paintFull = (ctx: CanvasRenderingContext2D, t: number) => {
      ctx.clearRect(0, 0, W, H)
      for (let i = 0; i < STRIPS; i++) {
        ctx.fillStyle = stripColor(i, t)
        ctx.fillRect(xs[i], 0, ws[i], H)
      }
    }
    const paintReveal = (ctx: CanvasRenderingContext2D, dissP: number, t: number) => {
      const cx = W / 2
      const zoom = 1 + dissP * 0.55
      const wipe = dissP * (1 + 0.18)
      ctx.clearRect(0, 0, W, H)
      for (let i = 0; i < STRIPS; i++) {
        const alpha = 1 - clamp01((wipe - order[i]) / 0.18)
        if (alpha <= 0) continue
        ctx.globalAlpha = alpha
        ctx.fillStyle = stripColor(i, t)
        ctx.fillRect(cx + (xs[i] - cx) * zoom, 0, ws[i] * zoom, H)
      }
      ctx.globalAlpha = 1
    }

    const block = (e: Event) => e.preventDefault()
    const blockKeys = (e: KeyboardEvent) => {
      if (['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(e.key)) e.preventDefault()
    }
    let locked = false
    const lock = () => {
      if (locked) return; locked = true
      getLenis()?.stop()
      window.addEventListener('wheel', block, { passive: false })
      window.addEventListener('touchmove', block, { passive: false })
      window.addEventListener('keydown', blockKeys, { passive: false })
    }
    const unlock = () => {
      if (!locked) return; locked = false
      getLenis()?.start()
      window.removeEventListener('wheel', block)
      window.removeEventListener('touchmove', block)
      window.removeEventListener('keydown', blockKeys)
    }

    // ── state ──
    let side: 'before' | 'after' = 'before'
    let playing = false
    let snapStart = 0
    let dir: 'down' | 'up' = 'down'
    let pinY = 0
    let cooldownUntil = 0
    let videoOn: boolean | null = null
    let rafId = 0

    const setVideo = (on: boolean) => {
      if (on === videoOn) return
      videoOn = on
      window.dispatchEvent(new Event(on ? 'diag-show' : 'diag-hide'))
    }

    // STEP 2: full silk takes over (fixed canvas), page snaps behind it
    const commit = (d: 'down' | 'up', now: number) => {
      const rect = runway.getBoundingClientRect()
      const top = rect.top + window.scrollY
      const bottom = top + runway.offsetHeight
      pinY = d === 'down' ? bottom : Math.max(0, top - H)   // pristine landing
      dir = d
      playing = true
      snapStart = now
      paintFull(cctx, now / 1000)        // fixed cover = full silk (seamless with the glimpse)
      cCanvas.style.opacity = '1'
      lock()
      window.scrollTo(0, pinY)           // snap behind the cover
      getLenis()?.scrollTo(pinY, { immediate: true })
      void document.documentElement.getBoundingClientRect()
      setVideo(d === 'down')             // video alive going down, paused going up
    }

    const frame = (now: number) => {
      rafId = requestAnimationFrame(frame)
      const t = now / 1000

      // ── STEP 3: reveal (fixed cover dissolves over the snapped section) ──
      if (playing) {
        if (window.scrollY !== pinY) window.scrollTo(0, pinY)
        const e = now - snapStart
        if (e < HOLD) { paintFull(cctx, t); return }            // hold fully covered
        const dissP = easeInOut(clamp01((e - HOLD) / DISSOLVE))
        if (e - HOLD >= DISSOLVE) {
          cCanvas.style.opacity = '0'
          cctx.clearRect(0, 0, W, H)
          playing = false
          side = dir === 'down' ? 'after' : 'before'
          unlock()
          cooldownUntil = now + 340
          return
        }
        paintReveal(cctx, dissP, t)
        return
      }

      // ── STEP 1: glimpse (sticky silk floats up between the sections) ──
      const rect = runway.getBoundingClientRect()
      const onScreen = rect.bottom > -40 && rect.top < H + 40
      if (onScreen) paintFull(gctx, t)
      else gctx.clearRect(0, 0, W, H)

      // video gate from position (hysteresis at runway midpoint)
      setVideo(rect.bottom < H * 0.5)

      // commit the instant the silk fully covers the viewport
      const fullyCovered = rect.top <= 0 && rect.bottom >= H
      if (fullyCovered && now >= cooldownUntil) {
        commit(side === 'before' ? 'down' : 'up', now)
      }
    }
    rafId = requestAnimationFrame(frame)

    const onNavGoto = (e: Event) => {
      const sel = (e as CustomEvent<string>).detail
      const el = document.querySelector(sel) as HTMLElement | null
      if (!el) return
      const y = Math.max(0, el.getBoundingClientRect().top + window.scrollY)
      const lenis = getLenis()
      if (lenis) lenis.scrollTo(y, { immediate: true })
      else window.scrollTo(0, y)
      cooldownUntil = performance.now() + 500
    }
    window.addEventListener('nav-goto', onNavGoto)

    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', layout)
      window.removeEventListener('nav-goto', onNavGoto)
      unlock()
    }
  }, [])

  return (
    <>
      <div ref={runwayRef} className="silk-runway" aria-hidden="true">
        <canvas ref={glimpseRef} className="silk-glimpse" />
      </div>
      <canvas ref={coverRef} className="silk-canvas" />
    </>
  )
}
