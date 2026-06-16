'use client'

import { useRef, useEffect } from 'react'

const STRIPS = 150

// Seeded RNG so the random layout is stable across renders
const seededRand = (seed: number) => {
  let s = seed
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646 }
}
const rng = seededRand(42)

// Randomized strip widths — mix of thin / medium / wide
const WEIGHTS = Array.from({ length: STRIPS }, () => {
  const r = rng()
  if (r < 0.18) return 0.22 + rng() * 0.18
  if (r < 0.30) return 1.4  + rng() * 0.5
  return 0.6 + rng() * 0.7
})
const TOTAL_W = WEIGHTS.reduce((a, b) => a + b, 0)

// tiny per-strip lightness jitter so the gradient still has subtle texture
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

    // ── timeline (ms) ────────────────────────────────────────────────────
    const RISE     = reduceMotion ? 0   : 520   // auto-rise from the trigger to full cover
    const DISSOLVE = reduceMotion ? 140 : 900   // centre-out reveal of the next section
    const FADE_W   = 0.18                        // per-strip vanish softness
    // Once the scrubbed cover reaches this fraction (≈ just past the bottom of the
    // outgoing section), lock and auto-play the rest of the curtain — so it fires
    // off a small deliberate scroll instead of needing a whole viewport.
    const TRIGGER  = 0.10

    // Deterministic start: this section is scroll-jacked and stateful, so never
    // let the browser restore a mid-page scroll position on refresh — it would
    // re-fire the transition and yank the user into the video/shaders section.
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
    window.scrollTo(0, 0)

    let W = 0, H = 0
    const xs    = new Float32Array(STRIPS)
    const ws    = new Float32Array(STRIPS)
    const order = new Float32Array(STRIPS)  // 0..1 — centre-out disappearance order

    const layout = () => {
      W = window.innerWidth
      H = window.innerHeight
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width  = W * dpr
      canvas.height = H * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      // Runway is a bit taller than one viewport: the band needs a full viewport
      // (H) to scrub the cover, plus headroom so the cover is fully up BEFORE the
      // video could ever enter the viewport.
      if (spacerRef.current) spacerRef.current.style.height = Math.round(H * 1.2) + 'px'
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

    // Live geometry of the black runway. spacerTop = its absolute top (= Services
    // bottom); spacerBottom = its absolute bottom (= video top). Read per frame so
    // it stays correct through reflow / resize.
    const geom = () => {
      const sp = spacerRef.current!
      const spacerTop = sp.getBoundingClientRect().top + window.scrollY
      const spacerH   = sp.offsetHeight
      return { spacerTop, spacerBottom: spacerTop + spacerH }
    }

    // ── HARD scroll lock (only during the brief dissolve reveal) ──────────
    // Block scroll at the INPUT layer so no device momentum can move the page
    // while the reveal plays. We never use overflow:hidden (it would block our
    // own teleport) and never snap-back via scroll events (that lagged → jitter).
    const block = (e: Event) => e.preventDefault()
    const blockKeys = (e: KeyboardEvent) => {
      const k = ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']
      if (k.includes(e.key)) e.preventDefault()
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

    // ── state ─────────────────────────────────────────────────────────────
    let side: 'before' | 'after' = 'before'   // which section the user is in
    let playing = false                        // auto-play (rise → dissolve) in progress
    let phaseRise = false                      // true during the rise, false during dissolve
    let phaseStart = 0                         // performance.now() at the current phase's start
    let startCoverP = 0                        // cover fraction captured at the trigger
    let revealDir: 'down' | 'up' = 'down'
    let pinY = 0                               // where to hold the page during the reveal
    let cooldownUntil = 0                      // brief guard right after a reveal lands
    let rafId = 0

    // shared per-strip colour for a given normalized x + time (the flowing field)
    const stripColor = (i: number, t: number): string => {
      const nx    = (xs[i] + ws[i] / 2) / W
      const drift = t * 0.16
      const n =
        Math.sin((nx * 2.2 + drift)             * 6.2832) * 0.55 +
        Math.sin((nx * 5.7 - drift * 1.3 + 0.7) * 6.2832) * 0.30 +
        Math.sin((nx * 11.0 + drift * 0.8 + 2.1) * 6.2832) * 0.15
      const v = clamp01(0.5 + n * 0.5 + (JITTER[i] - 0.5) * 0.03)
      // floor lifted off black: the valleys are a solid blue, not near-black, so
      // the curtain reads as a blue silk (no black background) the whole time.
      const light = 0.26 + Math.pow(v, 1.25) * 0.56    // solid blue → bright
      const hue   = 220 - v * 24                        // deep blue → cyan
      const sat   = 0.92 - Math.pow(v, 2.5) * 0.5       // saturated blue → white-blue
      const c = hsl(hue, sat, light)
      return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`
    }

    // COVER (scrub): a band of strips grows from the edge the incoming section
    // arrives from — bottom when scrolling down (video rises from below), top
    // when scrolling up (services drops in from above). Driven purely by scroll
    // position so it is exact on every frame at any speed → no section peeks.
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

    // REVEAL (dissolve): full-screen field that vanishes centre-out with a gentle
    // zoom — the cinematic beat that uncovers the new section.
    const paintReveal = (dissP: number, t: number) => {
      const cx   = W / 2
      const zoom = 1 + dissP * 0.55
      const wipe = dissP * (1 + FADE_W)
      ctx.clearRect(0, 0, W, H)
      for (let i = 0; i < STRIPS; i++) {
        const alpha = 1 - clamp01((wipe - order[i]) / FADE_W)
        if (alpha <= 0) continue
        const x = cx + (xs[i] - cx) * zoom
        const w = ws[i] * zoom
        ctx.globalAlpha = alpha
        ctx.fillStyle = stripColor(i, t)
        ctx.fillRect(x, 0, w, H)
      }
      ctx.globalAlpha = 1
    }

    // Commit: lock and AUTO-PLAY the rest of the curtain. We capture the cover
    // fraction reached at the trigger and rise from there to full, then dissolve.
    // Scroll is locked the whole time, so the rise can't be outpaced and nothing
    // peeks. The teleport to the far side happens at full cover (in frame()).
    const commit = (dir: 'down' | 'up', atCoverP: number) => {
      const { spacerTop, spacerBottom } = geom()
      // Land on a PRISTINE position: down → the true top of the video; up → Services
      // with its last row resting at the viewport bottom. Both sit at coverP === 0,
      // so the freshly-revealed section is never instantly re-covered.
      pinY = dir === 'down'
        ? spacerBottom                       // video top, not scrolled at all
        : Math.max(0, spacerTop - H)         // Services bottom fully in view

      playing = true
      phaseRise = true
      phaseStart = performance.now()
      startCoverP = atCoverP
      revealDir = dir
      lock()
    }

    // ── the single source of truth: one rAF loop, runs every frame ─────────
    // Reading window.scrollY here (not from lagging scroll EVENTS) is what makes
    // the cover frame-perfect: it is recomputed and repainted before each paint,
    // so the incoming section can never flash through, regardless of scroll speed.
    const frame = (now: number) => {
      rafId = requestAnimationFrame(frame)
      const t = now / 1000

      // ── auto-play in progress ──
      if (playing) {
        // Phase 1 — RISE: cover animates from the trigger fraction up to full while
        // the page stays locked (so it can never be outpaced and nothing peeks).
        if (phaseRise) {
          const riseP  = RISE <= 0 ? 1 : easeInOut(clamp01((now - phaseStart) / RISE))
          const coverP = startCoverP + (1 - startCoverP) * riseP
          canvas.style.opacity = '1'
          paintCover(coverP, revealDir === 'up', t)
          if (riseP >= 1) {
            // fully covered → teleport behind the curtain to the destination, gate
            // the video (alive going down / paused going up), then start the reveal
            window.scrollTo(0, pinY)
            getLenis()?.scrollTo(pinY, { immediate: true })
            void document.documentElement.getBoundingClientRect()
            window.dispatchEvent(new Event(revealDir === 'down' ? 'diag-show' : 'diag-hide'))
            phaseRise = false
            phaseStart = now
          }
          return
        }
        // Phase 2 — DISSOLVE: centre-out reveal of the destination section.
        if (window.scrollY !== pinY) window.scrollTo(0, pinY)   // pin behind the curtain
        const dissP = easeInOut(clamp01((now - phaseStart) / DISSOLVE))
        if (now - phaseStart >= DISSOLVE) {
          canvas.style.opacity = '0'
          ctx.clearRect(0, 0, W, H)
          playing = false
          side = revealDir === 'down' ? 'after' : 'before'
          unlock()
          cooldownUntil = now + 220
          return
        }
        canvas.style.opacity = '1'
        paintReveal(dissP, t)
        return
      }

      // ── settle guard right after a reveal lands ──
      if (now < cooldownUntil) { canvas.style.opacity = '0'; return }

      // ── scrubbed cover, tracking the runway so Services is NEVER overlapped ──
      // The band height equals exactly how much of the black runway is currently
      // showing in the viewport, so the band's far edge sits right on the
      // Services↔runway (or video↔runway) boundary. Services scrolls off the top
      // untouched; the band only ever rises over the runway.
      const { spacerTop, spacerBottom } = geom()
      const y = window.scrollY
      let coverP = 0
      let fromTop = false

      if (side === 'before') {
        // scrolling down: runway enters from the bottom → band rises from bottom,
        // its top edge pinned to the Services bottom (= spacerTop).
        coverP = clamp01((y + H - spacerTop) / H)
        fromTop = false
      } else {
        // scrolling up: runway enters from the top → band drops from the top, its
        // bottom edge pinned to the video top (= spacerBottom).
        coverP = clamp01((spacerBottom - y) / H)
        fromTop = true
      }

      // Reduced motion: no scrubbed strips (that is motion); stay clear until the
      // trigger, then auto-play (RISE = 0 → near-instant cover) and reveal.
      if (reduceMotion) {
        canvas.style.opacity = '0'
        if (coverP >= TRIGGER) commit(side === 'before' ? 'down' : 'up', 0)
        return
      }

      canvas.style.opacity = coverP > 0 ? '1' : '0'
      paintCover(coverP, fromTop, t)

      // Past the trigger fraction → lock and auto-play the rest of the curtain.
      // Works the same scrolling down or up.
      if (coverP >= TRIGGER) commit(side === 'before' ? 'down' : 'up', coverP)
    }

    // Nav links (SiteNav) / hero CTA hand off in-page jumps so the transition
    // doesn't hijack them. Cancel any reveal, settle the correct side, snap there.
    const onNavGoto = (e: Event) => {
      const sel = (e as CustomEvent<string>).detail
      const el = document.querySelector(sel) as HTMLElement | null
      if (!el) return
      const nextSide: 'before' | 'after' = sel === '#contact' ? 'after' : 'before'

      playing = false
      phaseRise = false
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
      {/* tiny sentinel — marks the services / spacer seam */}
      <div ref={sentinelRef} aria-hidden="true" style={{ height: 1 }} />
      {/* dedicated black scroll runway — the ONLY thing the shader rises over, so
          Services rows are never overlapped. Height is set in JS (≈1.2× viewport). */}
      <div ref={spacerRef} className="silk-spacer" aria-hidden="true" />
      <canvas ref={canvasRef} className="silk-canvas" />
    </>
  )
}
