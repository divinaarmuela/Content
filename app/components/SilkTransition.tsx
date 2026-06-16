'use client'

import { useRef, useEffect } from 'react'

const STRIPS = 150

// Seeded RNG so the random layout is stable across renders
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

    // ── self-contained timeline (ms) ──
    const COVER    = reduceMotion ? 0   : 240   // shader fades up to full cover
    const HOLD     = reduceMotion ? 0   : 120   // settled, fully covered (snap happens here)
    const DISSOLVE = reduceMotion ? 160 : 760   // centre-out reveal of the snapped section
    const FADE_W   = 0.18

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
      // Runway height set only on WIDTH change (not mobile address-bar resizes).
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

    // ── scroll lock (input layer; no overflow:hidden, no scrollTo-pinning churn) ──
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

    // ── state ──
    let side: 'before' | 'after' = 'before'
    let phase: 'idle' | 'cover' | 'hold' | 'reveal' = 'idle'
    let phaseStart = 0
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
      // floor lifted off black so the silk reads blue (no near-black columns)
      const light = 0.30 + Math.pow(v, 1.2) * 0.54
      const hue   = 214 - v * 18
      const sat   = 0.88 - Math.pow(v, 2.5) * 0.45
      const c = hsl(hue, sat, light)
      return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`
    }
    // full-screen silk (used while covering / holding) — uniform, no directional band
    const paintFull = (t: number) => {
      ctx.clearRect(0, 0, W, H)
      for (let i = 0; i < STRIPS; i++) {
        ctx.fillStyle = stripColor(i, t)
        ctx.fillRect(xs[i], 0, ws[i], H)
      }
    }
    // centre-out vanish — the reveal
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

    const startTransition = (dir: 'down' | 'up') => {
      const { spacerTop, spacerBottom } = geom()
      // snap target = the PRISTINE section, deep enough that we land far from the
      // trigger line (natural deadband → no ping-pong, no hysteresis needed)
      pinY = dir === 'down' ? spacerBottom : Math.max(0, spacerTop - H)
      revealDir = dir
      phase = 'cover'
      phaseStart = performance.now()
      lock()
    }

    const frame = (now: number) => {
      rafId = requestAnimationFrame(frame)
      const t = now / 1000

      if (phase === 'cover') {
        // shader fades up over the current view; nothing peeks because we trigger
        // mid-runway (the other section isn't in the viewport yet)
        const p = COVER <= 0 ? 1 : clamp01((now - phaseStart) / COVER)
        canvas.style.opacity = String(p)
        paintFull(t)
        if (p >= 1) {
          // snap to the destination behind the full cover, gate the video, then hold
          window.scrollTo(0, pinY)
          getLenis()?.scrollTo(pinY, { immediate: true })
          void document.documentElement.getBoundingClientRect()
          window.dispatchEvent(new Event(revealDir === 'down' ? 'diag-show' : 'diag-hide'))
          phase = 'hold'
          phaseStart = now
        }
        return
      }

      if (phase === 'hold') {
        if (window.scrollY !== pinY) window.scrollTo(0, pinY)
        canvas.style.opacity = '1'
        paintFull(t)
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
          cooldownUntil = now + 300
          return
        }
        canvas.style.opacity = '1'
        paintReveal(dissP, t)
        return
      }

      // ── idle: detect the crossing, then start the self-contained transition ──
      if (now < cooldownUntil) { canvas.style.opacity = '0'; return }
      canvas.style.opacity = '0'
      const { spacerTop, spacerBottom } = geom()
      const y = window.scrollY
      // Trigger ~halfway into the runway. We land deep in the section (snap), so the
      // landing sits a full 0.5 viewport from the trigger line — a deadband no
      // address-bar jump or momentum can cross, so it never loops.
      if (side === 'before' && y >= spacerTop - H * 0.5) startTransition('down')
      else if (side === 'after' && y <= spacerBottom - H * 0.5) startTransition('up')
    }

    // SiteNav / hero CTA in-page jumps hand off here so we don't hijack them.
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
