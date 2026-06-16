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

type Lenis = { stop: () => void; start: () => void; scrollTo: (target: number, opts?: { immediate?: boolean }) => void }

export default function SilkTransition() {
  const sentinelRef = useRef<HTMLDivElement>(null)
  const spacerRef   = useRef<HTMLDivElement>(null)
  const canvasRef   = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    // Touch devices scroll on the compositor thread; JS reads scrollY a frame
    // behind, so a scroll-tracked silk band desyncs and shows background slivers.
    // On touch we therefore DON'T track scroll — cover full-screen + snap + reveal.
    const isTouch =
      window.matchMedia('(hover: none), (pointer: coarse)').matches ||
      'ontouchstart' in window

    // ── timeline (ms) ──
    const COVER_DOWN = reduceMotion ? 0   : 340   // desktop glimpse → full cover (down)
    const COVER_UP   = reduceMotion ? 0   : 200   // desktop, faster up
    const HOLD       = reduceMotion ? 0   : 120
    const DISSOLVE   = reduceMotion ? 160 : 760
    const FADE_W     = 0.18

    // Desktop: commit at a half-screen silk glimpse (scroll-tracked band).
    // Touch: commit the instant the OUTGOING section has scrolled ~fully off — the
    // full-screen silk then slams over the (otherwise empty) runway with no
    // background frame, and isn't covering readable content (it's already gone).
    // Both land pristine; the trigger sits far enough from the landing to never loop.
    const TRIGGER       = 0.5      // desktop, on the clamped band coverage
    const TOUCH_TRIGGER = 0.95     // touch, on the RAW (uncapped) coverage

    if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
    window.scrollTo(0, 0)

    let W = 0, H = 0
    let lastLayoutW = -1
    const xs = new Float32Array(STRIPS)
    const ws = new Float32Array(STRIPS)
    const order = new Float32Array(STRIPS)

    const layout = () => {
      W = window.innerWidth
      H = window.innerHeight
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width  = W * dpr
      canvas.height = H * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      if (spacerRef.current && W !== lastLayoutW) {
        spacerRef.current.style.height = Math.round(H * 1.2) + 'px'
        lastLayoutW = W
      }
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
    const geom = () => {
      const sp = spacerRef.current!
      const top = sp.getBoundingClientRect().top + window.scrollY
      return { spacerTop: top, spacerBottom: top + sp.offsetHeight }
    }

    const block = (e: Event) => e.preventDefault()
    const blockKeys = (e: KeyboardEvent) => {
      if (['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(e.key)) e.preventDefault()
    }
    let locked = false
    const lock = () => {
      if (locked) return
      locked = true
      getLenis()?.stop()
      window.addEventListener('wheel', block, { passive: false })
      window.addEventListener('touchmove', block, { passive: false })
      window.addEventListener('keydown', blockKeys, { passive: false })
    }
    const unlock = () => {
      if (!locked) return
      locked = false
      getLenis()?.start()
      window.removeEventListener('wheel', block)
      window.removeEventListener('touchmove', block)
      window.removeEventListener('keydown', blockKeys)
    }

    let side: 'before' | 'after' = 'before'
    let phase: 'idle' | 'cover' | 'hold' | 'reveal' = 'idle'
    let phaseStart = 0
    let startCoverP = 0
    let revealDir: 'down' | 'up' = 'down'
    let pinY = 0
    let cooldownUntil = 0
    let rafId = 0

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
    const paintFull = (t: number) => {
      ctx.clearRect(0, 0, W, H)
      for (let i = 0; i < STRIPS; i++) {
        ctx.fillStyle = stripColor(i, t)
        ctx.fillRect(xs[i], 0, ws[i], H)
      }
    }
    const paintCover = (coverP: number, fromTop: boolean, t: number) => {
      ctx.clearRect(0, 0, W, H)
      if (coverP <= 0) return
      const bandH = coverP * H
      const y0 = fromTop ? 0 : H - bandH
      for (let i = 0; i < STRIPS; i++) {
        ctx.fillStyle = stripColor(i, t)
        ctx.fillRect(xs[i], y0, ws[i], bandH)
      }
    }
    const paintReveal = (dissP: number, t: number) => {
      const cx = W / 2
      const zoom = 1 + dissP * 0.55
      const wipe = dissP * (1 + FADE_W)
      ctx.clearRect(0, 0, W, H)
      for (let i = 0; i < STRIPS; i++) {
        const alpha = 1 - clamp01((wipe - order[i]) / FADE_W)
        if (alpha <= 0) continue
        ctx.globalAlpha = alpha
        ctx.fillStyle = stripColor(i, t)
        ctx.fillRect(cx + (xs[i] - cx) * zoom, 0, ws[i] * zoom, H)
      }
      ctx.globalAlpha = 1
    }

    const scrubCover = () => {
      const { spacerTop, spacerBottom } = geom()
      const y = window.scrollY
      // raw = uncapped coverage (>1 once the outgoing section is fully gone)
      const raw = side === 'before' ? (y + H - spacerTop) / H : (spacerBottom - y) / H
      return { coverP: clamp01(raw), raw, fromTop: side !== 'before' }
    }

    const startTransition = (dir: 'down' | 'up', atCoverP: number) => {
      const { spacerTop, spacerBottom } = geom()
      pinY = dir === 'down' ? spacerBottom : Math.max(0, spacerTop - H)  // PRISTINE landing
      revealDir = dir
      startCoverP = atCoverP
      phase = 'cover'
      phaseStart = performance.now()
      lock()
    }

    const doSnap = (now: number) => {
      window.scrollTo(0, pinY)
      getLenis()?.scrollTo(pinY, { immediate: true })
      void document.documentElement.getBoundingClientRect()
      window.dispatchEvent(new Event(revealDir === 'down' ? 'diag-show' : 'diag-hide'))
      phase = 'hold'
      phaseStart = now
    }

    const frame = (now: number) => {
      rafId = requestAnimationFrame(frame)
      const t = now / 1000

      if (phase === 'cover') {
        if (isTouch) {
          // full-screen cover, NOT scroll-tracked → no desync on mobile
          canvas.style.opacity = '1'
          paintFull(t)
          doSnap(now)
        } else {
          const dur = revealDir === 'up' ? COVER_UP : COVER_DOWN
          const p = dur <= 0 ? 1 : easeInOut(clamp01((now - phaseStart) / dur))
          const animP = startCoverP + (1 - startCoverP) * p
          const coverP = Math.max(animP, scrubCover().coverP)
          canvas.style.opacity = '1'
          paintCover(coverP, revealDir === 'up', t)
          if (coverP >= 1) doSnap(now)
        }
        return
      }

      if (phase === 'hold') {
        if (window.scrollY !== pinY) window.scrollTo(0, pinY)
        canvas.style.opacity = '1'
        paintReveal(0, t)
        if (now - phaseStart >= HOLD) { phase = 'reveal'; phaseStart = now }
        return
      }

      if (phase === 'reveal') {
        if (window.scrollY !== pinY) window.scrollTo(0, pinY)
        const dissP = easeInOut(clamp01((now - phaseStart) / DISSOLVE))
        if (now - phaseStart >= DISSOLVE) {
          canvas.style.opacity = '0'
          ctx.clearRect(0, 0, W, H)
          phase = 'idle'
          side = revealDir === 'down' ? 'after' : 'before'
          unlock()
          cooldownUntil = now + 320
          return
        }
        canvas.style.opacity = '1'
        paintReveal(dissP, t)
        return
      }

      // ── idle ──
      if (now < cooldownUntil) { canvas.style.opacity = '0'; return }
      const { coverP, raw, fromTop } = scrubCover()
      if (isTouch) {
        // No scroll-tracked glimpse (desyncs on mobile). Stay clear while the
        // outgoing section scrolls off; the instant it's ~gone, fire the cover.
        canvas.style.opacity = '0'
        if (raw >= TOUCH_TRIGGER) startTransition(side === 'before' ? 'down' : 'up', 1)
      } else {
        canvas.style.opacity = coverP > 0 ? '1' : '0'
        paintCover(coverP, fromTop, t)
        if (coverP >= TRIGGER) startTransition(side === 'before' ? 'down' : 'up', coverP)
      }
    }

    const onNavGoto = (e: Event) => {
      const sel = (e as CustomEvent<string>).detail
      const el = document.querySelector(sel) as HTMLElement | null
      if (!el) return
      const nextSide: 'before' | 'after' = sel === '#contact' ? 'after' : 'before'
      phase = 'idle'
      canvas.style.opacity = '0'
      ctx.clearRect(0, 0, W, H)
      side = nextSide
      unlock()
      window.dispatchEvent(new Event(nextSide === 'after' ? 'diag-show' : 'diag-hide'))
      const targetY = Math.max(0, el.getBoundingClientRect().top + window.scrollY)
      const lenis = getLenis()
      if (lenis) lenis.scrollTo(targetY, { immediate: true })
      else window.scrollTo(0, targetY)
      cooldownUntil = performance.now() + 600
    }
    window.addEventListener('nav-goto', onNavGoto)

    rafId = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('nav-goto', onNavGoto)
      window.removeEventListener('resize', layout)
      unlock()
    }
  }, [])

  return (
    <>
      <div ref={sentinelRef} aria-hidden="true" style={{ height: 1 }} />
      <div ref={spacerRef} className="silk-spacer" aria-hidden="true" />
      <canvas ref={canvasRef} className="silk-canvas" />
    </>
  )
}
